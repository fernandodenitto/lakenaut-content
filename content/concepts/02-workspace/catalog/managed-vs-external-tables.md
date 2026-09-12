---
id: managed-vs-external-tables
title: Managed and external tables
area: catalog
level: intermediate
summary: In a managed table Unity Catalog governs both metadata and files and deletes them on DROP; in an external table it governs only the metadata, and the files stay in the path you specified with LOCATION.
prerequisites: [unity-catalog-overview, delta-lake-overview]
related: [privileges-grant-revoke, liquid-clustering, ingestion-patterns, copy-into]
exams:
  - cert: de-associate
    domain: "Governance and Security"
    objective: "Differentiate between managed and external tables in Unity Catalog and perform basic operations (create, modify, delete, and convert between managed and external tables) on them."
sources:
  - url: https://docs.databricks.com/aws/en/tables/
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/tables/managed
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/tables/external
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/tables/convert-to-managed
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-ddl-alter-table
    checked: 2026-09-09
aliases: [managed table, external table, unmanaged table, set managed, undrop]
updated: 2026-09-09
status: published
---

## What it is

A table in Unity Catalog has two components: the **metadata** (name, schema, permissions, statistics) and the **files** in object storage. The distinction between **managed** and **external** is about who controls the files.

| | Managed | External |
| --- | --- | --- |
| Metadata | Unity Catalog | Unity Catalog |
| Data files | Unity Catalog, in the managed location of the schema/catalog/metastore | you, in the path chosen with `LOCATION` inside an external location |
| `DROP TABLE` | metadata and files deleted (files after the retention window) | metadata only, the files remain |
| Formats | Delta and Iceberg | Delta, Parquet, CSV, JSON, Avro, ORC, TEXT |
| Automatic optimizations | predictive optimization, automatic liquid clustering | no |
| Direct file access from external clients | through the Unity Catalog APIs | yes, but without permission enforcement |

## Why it exists

Managed is the default and the recommended choice: it costs less in storage and query time, optimizes itself, and can be recovered if dropped by mistake. External serves two concrete cases: registering data that already exists in a format Unity Catalog cannot manage (JSON, Avro, Parquet written by other systems) and letting other systems read the files directly from the bucket.

## How it works

### Creating

Without `LOCATION` the table is managed. The files land in the most specific managed location available: the schema's, otherwise the catalog's, otherwise the metastore root.

```sql
CREATE TABLE prod.sales.orders (
  id BIGINT, amount DECIMAL(10,2), order_date DATE
);
```

```python
df.write.saveAsTable("prod.sales.orders")
```

With `LOCATION` the table is external. The path must sit inside an **external location** on which you have `CREATE EXTERNAL TABLE`, in addition to `USE CATALOG`, `USE SCHEMA`, and `CREATE TABLE` on the levels above.

```sql
CREATE TABLE prod.sales.ordini_ext (
  id BIGINT, amount DECIMAL(10,2), order_date DATE
)
LOCATION 's3://acme-prod-data/sales/orders/';
```

```python
(df.write
   .option("path", "s3://acme-prod-data/sales/orders/")
   .saveAsTable("prod.sales.ordini_ext"))
```

To find out which type a table is: `DESCRIBE EXTENDED prod.sales.orders` shows `Type: MANAGED` or `EXTERNAL` along with the `Location`.

### Modifying

`ALTER TABLE` works the same on both types: renaming, adding columns, changing properties, transferring ownership with `ALTER TABLE t OWNER TO principal`. Delta writes (INSERT, MERGE, UPDATE) are identical. The difference is that on an external table other systems can write files "from the outside": Unity Catalog does not notice, and for non-Delta formats you need `MSCK REPAIR TABLE` to realign the partitions.

### Dropping

```sql
DROP TABLE prod.sales.orders;      -- managed: files deleted after the retention window
DROP TABLE prod.sales.ordini_ext;  -- external: the files stay in the bucket
```

For a managed table, recovery is possible until the retention expires (default 7 days, configurable with `ALTER CATALOG prod RETAIN DROPPED TO 30 DAYS` or at the schema level):

```sql
UNDROP TABLE prod.sales.orders;
```

For an external table there is nothing to recover: you recreate the metadata with the same `CREATE TABLE ... LOCATION`, and the files are still there.

### Converting

An external Delta table can be converted to managed without rewriting the code that uses it:

```sql
ALTER TABLE prod.sales.ordini_ext SET MANAGED;
```

The files are **copied** into the managed location in two phases: an initial copy without stopping the loads, then a short switch (a few minutes) during which writes pause and the metadata changes. You need to be the owner, the format must be Delta, and you need Databricks Runtime 17.3 LTS or serverless. If the table has Iceberg reads enabled, add `TRUNCATE UNIFORM HISTORY`.

Within 14 days you can roll back:

```sql
ALTER TABLE prod.sales.ordini_ext UNSET MANAGED;
```

`SET EXTERNAL` exists but serves a different purpose: it converts a **foreign** table (Lakehouse Federation) into an external one; `SET MANAGED { MOVE | COPY }` does the same toward managed. It is not the way to make a native managed table external: for that you use `UNSET MANAGED` within the rollback window, otherwise `CREATE TABLE ... LOCATION AS SELECT`.

## Example

A vendor drops Parquet files in `s3://acme-landing/fornitore-a/`. You want to query them today and bring them under control tomorrow:

```sql
CREATE TABLE prod.bronze.fornitore_a
USING PARQUET
LOCATION 's3://acme-landing/fornitore-a/';

-- once the data is stable: materialize as managed Delta
CREATE TABLE prod.silver.fornitore_a AS
SELECT * FROM prod.bronze.fornitore_a;
```

You do not use `SET MANAGED` here because the source is Parquet, not Delta.

## Common mistakes

- Running `DROP TABLE` on a managed table assuming the files stay: they stay only for the `UNDROP` window.
- Running `DROP TABLE` on an external table to "free up space": the files are still there and you keep paying for them.
- Creating two external tables on the same path: writes from one corrupt the other.
- Reading an external table by path (`spark.read.load("s3://...")`) and expecting Unity Catalog permissions to apply: only the privileges on the external location apply.
- Trying `SET MANAGED` on an external Parquet table: it only works with Delta.

> [!exam]
> Classic questions: "what happens to the data on DROP TABLE?" (managed: deleted; external: kept), "how do I create an external table?" (`LOCATION` inside an external location with the right privileges), "which one for data already in storage that other tools also read?" (external), "which one for the default and automatic optimizations?" (managed). Know that `ALTER TABLE ... SET MANAGED` exists to convert an external Delta table, that `UNDROP` recovers a managed table within the retention window, and that `DESCRIBE EXTENDED` tells you the type.
