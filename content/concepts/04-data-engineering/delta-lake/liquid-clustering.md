---
id: liquid-clustering
title: Liquid clustering
area: delta-lake
level: intermediate
summary: Liquid Clustering replaces partitioning and Z-ORDER with mutable clustering keys and incremental OPTIMIZE; predictive optimization runs OPTIMIZE, VACUUM, and statistics on its own on managed tables.
prerequisites: [delta-lake-overview, managed-vs-external-tables]
related: [delta-lake-overview, managed-vs-external-tables, spark-tuning-basics, spark-ui-bottlenecks, unity-catalog-overview]
exams:
  - cert: de-associate
    domain: "Troubleshooting, Monitoring, and Optimization"
    objective: "Understand the features of Liquid Clustering and predictive optimization."
sources:
  - url: https://docs.databricks.com/aws/en/delta/clustering
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/optimizations/predictive-optimization
    checked: 2026-09-09
aliases: [predictive optimization, z-order, zorder, cluster by, cluster by auto, optimize, vacuum, data layout]
updated: 2026-09-12
status: published
---

## What it is

**Liquid Clustering** is how Delta Lake (see [[delta-lake-overview]]) physically organizes a table's files around one or more columns, so that queries filtering on those columns read fewer files. It replaces two older techniques: folder-based **partitioning** and the **Z-ORDER** performed by `OPTIMIZE`. Keys are declared with `CLUSTER BY` and can be changed at any time.

**Predictive optimization** is the service that, on Unity Catalog managed tables, decides on its own when to run `OPTIMIZE`, `VACUUM`, and statistics collection, and does so on serverless compute with no job to schedule.

## Why it exists

Partitioning has to be chosen at creation time, only works well with low-cardinality columns, and, if chosen poorly, produces thousands of tiny folders or a handful of huge ones. Z-ORDER improves the layout inside partitions but rewrites all the data on every run and has to be triggered by hand. Liquid Clustering removes both constraints; predictive optimization removes the scheduled maintenance that every team eventually forgot to run.

## How it works

### Declaring the keys

```sql
CREATE TABLE sales (data DATE, negozio_id INT, amount DECIMAL(10,2))
CLUSTER BY (data, negozio_id);

ALTER TABLE sales CLUSTER BY (negozio_id);   -- changes the keys, rewrites nothing
ALTER TABLE sales CLUSTER BY NONE;           -- disables clustering
```

Up to **four** clustering columns. New writes respect the current keys; existing files stay as they are until `OPTIMIZE` reorganizes them. You can see the keys with `DESCRIBE DETAIL` (the `clusteringColumns` field).

With **`CLUSTER BY AUTO`**, Databricks picks and updates the keys itself based on the predicates it sees in your queries. It requires a Unity Catalog managed table with predictive optimization enabled.

From PySpark: `df.write.clusterBy("data", "negozio_id").saveAsTable("sales")`. Streaming tables and materialized views in pipelines support `CLUSTER BY` the same way.

### Incremental OPTIMIZE

```sql
OPTIMIZE sales;          -- reorganizes only the files not yet clustered
OPTIMIZE sales FULL;     -- rewrites everything: after a key change or the first activation
```

With clustering, `OPTIMIZE` is **incremental**: it only touches files that arrived since the last run, so it's cheap and can run often. `FULL` is needed only when you change the keys on a table that already has data.

### Comparison

| | Partitioning | Z-ORDER | Liquid Clustering |
| --- | --- | --- | --- |
| Declared with | `PARTITIONED BY` | `OPTIMIZE … ZORDER BY` | `CLUSTER BY` |
| Changeable afterward | no, recreate the table | yes, on every OPTIMIZE | yes, `ALTER TABLE` |
| Column cardinality | low (date, country) | any | any, including high |
| Maintenance cost | none, but risk of small files | full rewrite | incremental |
| Concurrent writes | conflicts per partition | conflicts across the whole table | row-level concurrency |
| Compatible with the others | with Z-ORDER | with partitions | **no**: mutually exclusive |

Databricks recommends Liquid Clustering for **all new tables**. It particularly pays off with filters on high-cardinality columns, skewed data, fast-growing tables, changing access patterns, and concurrent writes.

### Automatic maintenance

Clustering is only useful if something keeps applying it. On Unity Catalog managed tables that something is [[predictive-optimization]], which runs `OPTIMIZE`, `VACUUM` and `ANALYZE` when it judges the benefit worth the cost, including the incremental clustering described above. It never applies `ZORDER`.

The practical consequence for this page: on a managed table you declare the keys and stop. On an external table you are still responsible for scheduling `OPTIMIZE` yourself.

## Example

Migrating a table partitioned by day that suffers from small files and slow queries filtered on `cliente_id`:

```sql
-- 1. new table with clustering, loaded from the old one
CREATE TABLE vendite_prod.silver.ordini_v2
CLUSTER BY (cliente_id, data_ordine)
AS SELECT * FROM vendite_prod.silver.orders;

-- 2. first full layout pass
OPTIMIZE vendite_prod.silver.ordini_v2 FULL;

-- 3. from here on predictive optimization takes over (schema enabled);
--    alternatively, a periodic SQL task:
OPTIMIZE vendite_prod.silver.ordini_v2;
```

```python
(spark.table("vendite_prod.silver.orders")
   .write.clusterBy("cliente_id", "data_ordine")
   .saveAsTable("vendite_prod.silver.ordini_v2"))
spark.sql("OPTIMIZE vendite_prod.silver.ordini_v2 FULL")
```

## Common mistakes

- Declaring `CLUSTER BY` and `PARTITIONED BY` on the same table: an error, they're mutually exclusive.
- Changing the keys with `ALTER TABLE` and expecting faster queries right away: without `OPTIMIZE FULL`, old data stays in its previous layout.
- Picking too many keys: you can't go beyond four, and even three or four on small tables can make filters on a single column worse.
- Turning on predictive optimization and expecting it to touch external tables: it doesn't; those need scheduled `OPTIMIZE` and `VACUUM`.
- Still running `OPTIMIZE ZORDER BY` on clustered tables: it's not allowed, and it would do a worse job anyway.

> [!exam]
> The questions ask you to recognize the characteristics, not to execute anything: Liquid Clustering is declared with **`CLUSTER BY`**, the keys are **mutable**, `OPTIMIZE` is **incremental**, it's **incompatible** with partitioning and Z-ORDER, and it's the recommended choice for new tables. Predictive optimization automatically runs **OPTIMIZE, VACUUM, and statistics**, **only on managed tables** in Unity Catalog, and is enabled at the account, catalog, schema, or table level with `ENABLE PREDICTIVE OPTIMIZATION`. Typical question: "slow queries on a high-cardinality column in a table partitioned by date" → Liquid Clustering on the filtered column.
