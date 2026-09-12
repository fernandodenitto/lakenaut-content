---
id: dataframe-io
title: Reading and writing DataFrames
area: foundations-python
level: beginner
summary: How spark.read and DataFrameWriter load and persist data on Databricks, and why saving to a Unity Catalog table beats saving to a path.
prerequisites: [pyspark-vs-pandas, unity-catalog-overview]
related: [managed-vs-external-tables, delta-lake-overview, semi-structured-data, auto-loader]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/query/formats/
    checked: 2026-09-10
aliases: [spark.read, spark.table, saveAsTable, read_files, mergeSchema, save modes]
updated: 2026-09-10
status: published
---

## What it is

`spark.read` builds a DataFrame from files or an external source; `df.write` persists a DataFrame somewhere. Databricks defaults everything to Delta Lake (see [[delta-lake-overview]]), so `spark.read.parquet(...)` and friends exist mostly for reading data that arrived from outside the platform, not for your own tables.

In SQL, the equivalent is `read_files`, a table-valued function that reads a directory of files with the same format options as the Python reader.

## Why it exists

Bronze ingestion needs to read whatever format a source system produces — CSV exports, JSON from an API, Parquet from another warehouse — while everything you write for silver and gold should land as Delta so downstream tools get ACID guarantees, schema enforcement, and time travel. `spark.read`/`spark.write` cover both jobs with one API, switching behavior through a `format(...)` call and a handful of options instead of a different library per file type.

## How it works

### Reading

`spark.read.format("csv"|"json"|"parquet"|"delta").options(...).load(path)` reads files directly. `spark.table("catalog.schema.table")` (or the shorthand `spark.read.table(...)`) reads a table already registered in Unity Catalog by name — this is what you should reach for once data is past bronze, since it doesn't require knowing the storage path.

### Writing: `save` versus `saveAsTable`

| | `df.write.save(path)` | `df.write.saveAsTable("catalog.schema.table")` |
| --- | --- | --- |
| Registers a table in Unity Catalog | No | Yes |
| Addressed by | Storage path | Three-level name |
| Typical use | One-off files, external interchange | Anything other pipelines or users query |

On Databricks, `saveAsTable` is almost always the right call: it makes the output governed, discoverable, and queryable from SQL without anyone needing to know where the files live. Writing to a bare path produces data nobody but you can find (see [[managed-vs-external-tables]] for the managed/external distinction that still applies once a table is registered).

### Save modes

`.mode(...)` controls what happens if the target already has data:

| Mode | Behavior |
| --- | --- |
| `append` | Add rows to what exists |
| `overwrite` | Replace existing data entirely |
| `error` / `errorifexists` (default) | Fail if the target already exists |
| `ignore` | Do nothing if the target already exists |

### Schema evolution and partitioning

`overwrite` fails by default if the DataFrame's schema doesn't match the existing table. Two options relax that: `.option("mergeSchema", "true")` adds new columns instead of failing, and `.option("overwriteSchema", "true")` replaces the table's schema outright — use it deliberately, since it can silently drop columns that aren't in the new DataFrame.

`.partitionBy("column")` writes separate directories per partition value. It sounds like free performance but usually isn't the right call on Delta tables: partitioning by a low-cardinality column you always filter on (like `country`) can help, but partitioning by something high-cardinality (like `event_date` at hourly grain, or a customer ID) creates too many small files and hurts more than it helps. Delta's liquid clustering and file-level statistics do most of what manual partitioning used to do — reach for explicit `partitionBy` only when you have a specific, measured reason.

## Example

```sql
CREATE TABLE shop.silver.orders
USING DELTA
AS SELECT * FROM read_files(
  '/Volumes/shop/bronze/orders_csv',
  format => 'csv',
  header => true
);
```

```python
raw = (
    spark.read
    .format("csv")
    .option("header", "true")
    .option("inferSchema", "true")
    .load("/Volumes/shop/bronze/orders_csv")
)

(
    raw.write
    .format("delta")
    .mode("overwrite")
    .option("mergeSchema", "true")
    .saveAsTable("shop.silver.orders")
)

# Downstream code reads by name, not by path.
orders = spark.table("shop.silver.orders")
```

## Common mistakes

- Using `.save(path)` for tables that other people or jobs need: they end up with no discoverable name, no lineage, no grants in Unity Catalog.
- Forgetting that `errorifexists` is the default mode: a rerun of a notebook fails with a confusing error instead of appending or overwriting.
- Adding `mergeSchema` everywhere out of habit: it hides real schema drift (a renamed or dropped source column) instead of surfacing it.
- Partitioning a table "for performance" without checking whether the query patterns and cardinality actually justify it — too many small files makes reads slower, not faster.
- Reading with `spark.read.load(path)` when the data is Delta and already a registered table: `spark.table(...)` is simpler and doesn't depend on the physical path staying put.

> [!tip]
> Default to Delta and to `saveAsTable` for anything that isn't a one-off. Reach for `spark.read.format(...)` only at the bronze boundary, where you're reading someone else's file format for the first time.
