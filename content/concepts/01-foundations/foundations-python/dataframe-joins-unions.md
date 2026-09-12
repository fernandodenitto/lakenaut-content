---
id: dataframe-joins-unions
title: Joins and unions between DataFrames
area: foundations-python
level: intermediate
summary: How to combine DataFrames in PySpark and Spark SQL. Join types, multiple keys, broadcast joins, and the differences between union, unionByName, UNION ALL, and UNION.
prerequisites: [dataframe-columns-rows, medallion-architecture]
related: [dataframe-dedup-aggregations, spark-tuning-basics, spark-ui-bottlenecks]
exams:
  - cert: de-associate
    domain: "Data Transformation and Modeling"
    objective: "Combine DataFrames with operations such as Inner join, left join, broadcast join, multiple keys, cross join, union, and union all."
sources:
  - url: https://docs.databricks.com/aws/en/pyspark/basics
    checked: 2026-09-09
  - url: https://spark.apache.org/docs/latest/api/python/reference/pyspark.sql/api/pyspark.sql.DataFrame.join.html
    checked: 2026-09-09
  - url: https://spark.apache.org/docs/latest/sql-performance-tuning.html
    checked: 2026-09-09
aliases: [join pyspark, broadcast join, unionByName, union all]
updated: 2026-09-09
status: published
---

## What it is

A **join** combines two DataFrames by pairing rows that satisfy a condition; a **union** stacks them on top of each other. These are the two operations used in silver and gold to enrich facts with dimensions and to bring together data from different sources.

In PySpark the method is `DataFrame.join(other, on, how)`; in Spark SQL you write it like in any database. The difference from Postgres isn't the syntax but the **cost**: a join between two large tables requires a shuffle, meaning data gets transferred between the cluster's nodes.

## Why it exists

The medallion model (see [[medallion-architecture]]) keeps facts and dimensions separate until gold. The join is where the earlier choices get paid for: poorly typed keys, duplicates never removed, dimensions never filtered. Understanding join types and the physical strategy (shuffle or broadcast) is the foundation for reading the Spark UI (see [[spark-ui-bottlenecks]]).

## How it works

### Join types

| `how` | Rows returned | Columns |
| --- | --- | --- |
| `inner` (default) | matches only | both |
| `left` (`leftouter`) | all left rows, `NULL` where there's no match | both |
| `right` (`rightouter`) | all right rows | both |
| `outer` (`full`, `fullouter`) | all rows from both | both |
| `left_semi` | left rows that have a match | left only |
| `left_anti` | left rows **without** a match | left only |
| `cross` | cartesian product | both |

`left_semi` and `left_anti` are the equivalents of `WHERE EXISTS` and `WHERE NOT EXISTS`: useful for filtering without duplicating rows.

### Keys

If the key columns share the same name, `on` accepts a string or a list: `on=["customer_id", "country"]`. The result contains the key only once. If the names differ, you pass a boolean condition instead: `on=orders.cust_id == customers.id`; in that case both columns remain in the result and need to be handled with `drop` or an alias. Multiple conditions combine with `&`, each wrapped in parentheses.

### Broadcast join

When one of the two tables is small, Spark copies it in full to every executor and avoids shuffling the large table. It does this on its own below the `spark.sql.autoBroadcastJoinThreshold` threshold (10 MB by default; `-1` disables it). You can force it with `broadcast(df)` in Python, or the `/*+ BROADCAST(alias) */` hint in SQL. With AQE on (see [[spark-tuning-basics]]), Spark can convert a join into a broadcast even at runtime, when it discovers one side is smaller than expected.

### Union

| Operation | Matches by | Duplicates |
| --- | --- | --- |
| `df1.union(df2)` | column **position** | kept |
| `df1.unionByName(df2, allowMissingColumns=True)` | column **name** | kept |
| `UNION ALL` (SQL) | position | kept |
| `UNION` / `UNION DISTINCT` (SQL) | position | removed |

Careful: PySpark's `union` corresponds to SQL's `UNION ALL`, not `UNION`. To remove duplicates you need `.distinct()` afterward. `unionAll` still exists as an alias but is deprecated.

## Example

Orders enriched with customers (a small dimension, so broadcast) and exchange rates (a double key).

```sql
SELECT /*+ BROADCAST(c) */
  o.order_id, o.amount, c.segment, r.rate
FROM shop.silver.orders o
JOIN shop.silver.customers c
  ON o.customer_id = c.customer_id
LEFT JOIN shop.silver.fx_rates r
  ON o.currency = r.currency AND o.order_date = r.rate_date;
```

```python
from pyspark.sql import functions as F
from pyspark.sql.functions import broadcast

orders = spark.read.table("shop.silver.orders")
customers = spark.read.table("shop.silver.customers")
rates = spark.read.table("shop.silver.fx_rates")

enriched = (
    orders
    .join(broadcast(customers), on="customer_id", how="inner")
    .join(
        rates,
        on=(orders.currency == rates.currency) & (orders.order_date == rates.rate_date),
        how="left",
    )
    .select("order_id", "amount", "segment", "rate")
)
```

Combining orders from two systems with columns in a different order and one extra field:

```sql
SELECT order_id, amount, channel FROM shop.silver.orders_web
UNION ALL
SELECT order_id, amount, NULL AS channel FROM shop.silver.orders_store;
```

```python
web = spark.read.table("shop.silver.orders_web")
store = spark.read.table("shop.silver.orders_store")

all_orders = web.unionByName(store, allowMissingColumns=True)
```

An explicit `crossJoin` is used to generate combinations, for example every product for every day on a calendar:

```python
calendar = spark.read.table("shop.gold.dim_date").select("date")
grid = products.crossJoin(calendar)
```

## Common mistakes

- Using `union` with columns in a different order: it doesn't error out if the types match, but it scrambles the data. Prefer `unionByName`.
- Expecting `union` to deduplicate the way SQL's `UNION` does: it doesn't.
- Joining on keys with different types (`STRING` vs. `BIGINT`): Spark converts implicitly, and the join becomes slow, or fails to find matches. Align the types in silver.
- A dimension with duplicate keys: an `inner` join multiplies the fact rows. Deduplicate first (see [[dataframe-dedup-aggregations]]).
- Forcing a `broadcast` on a gigabyte-sized table: executors run out of memory.
- An accidental cross join from a forgotten join condition: since Spark 3 it's no longer blocked by default, and the result silently explodes. Use `crossJoin` only when you actually mean it.

> [!exam]
> You need to distinguish the `how` values (`inner`, `left`, `outer`, `left_semi`, `left_anti`, `cross`), know that multiple keys are passed as a list or as a condition with `&`, that `broadcast()` avoids the shuffle for small tables, and that PySpark's `union` is equivalent to `UNION ALL` while `unionByName` matches by name. Classic question: "which operation returns only the left table's rows with no match?" → `left_anti`.
