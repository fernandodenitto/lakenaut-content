---
id: copy-into
title: COPY INTO
area: data-ingestion
subarea: cloud-storage
level: intermediate
summary: COPY INTO is the idempotent SQL command that loads files from object storage into a Delta table, remembering what it already loaded and running from a SQL warehouse.
prerequisites: [ingestion-patterns, delta-lake-overview]
related: [auto-loader, semi-structured-data, unity-catalog-overview, jobs-overview]
exams:
  - cert: de-associate
    domain: "Data Ingestion and Loading"
    objective: "Use the COPY INTO command to incrementally load files from cloud object storage (ADLS/S3/GCS) into Unity-Catalog-governed tables."
sources:
  - url: https://docs.databricks.com/aws/en/ingestion/cloud-object-storage/copy-into/
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/sql/language-manual/delta-copy-into
    checked: 2026-09-09
aliases: [copy into, copy command, idempotent load]
updated: 2026-09-09
status: published
---

## What it is

`COPY INTO` is a SQL command that reads files from cloud object storage (S3, ADLS, GCS) or from a Unity Catalog volume and appends them to a Delta table. Its key property: it is **idempotent**. It keeps track of the files it has already loaded and, when you rerun it on the same path, skips the ones it has seen. You can schedule it every hour with no risk of duplicates.

## Why it exists

An `INSERT INTO ... SELECT * FROM read_files(...)` works exactly once: on the second run it reloads everything. Before `COPY INTO` you had to maintain a ledger of processed files by hand. `COPY INTO` folds that ledger into the target table and exposes it as pure SQL, runnable from a notebook, from a SQL task in a job (see [[jobs-overview]]), or directly from a SQL warehouse, with no checkpoint and no Python code.

## How it works

Core syntax:

```sql
COPY INTO <catalog>.<schema>.<table>
FROM '<path>'
FILEFORMAT = <format>
[FILES = ('a.csv', 'b.csv') | PATTERN = '<glob>']
[FORMAT_OPTIONS (...)]
[COPY_OPTIONS (...)];
```

### FILEFORMAT

Accepted formats are `CSV`, `JSON`, `AVRO`, `ORC`, `PARQUET`, `TEXT`, `BINARYFILE`. Source files can also be compressed.

### FILES and PATTERN

`FILES` lists up to 1000 explicit file names; `PATTERN` takes a glob (`*.json`, `2026-0[1-6]/*.parquet`, `{orders,resi}_*.csv`). They are mutually exclusive.

### FORMAT_OPTIONS

Options passed to the format reader, the same ones the Spark data sources accept: for CSV `header`, `delimiter`, `inferSchema`; for JSON `multiLine`; for all formats `rescuedDataColumn`, which stores values that don't fit the schema in a dedicated column (see [[semi-structured-data]]).

### COPY_OPTIONS

Options that govern the command's behavior:

| Option | Default | Effect |
| --- | --- | --- |
| `mergeSchema` | `false` | adds new columns found in the files to the table (schema evolution) |
| `force` | `false` | disables idempotency: reloads every file, including those already processed |

Watch out for the double `mergeSchema`: in `FORMAT_OPTIONS` it asks the reader to merge the schemas of the files with each other; in `COPY_OPTIONS` it evolves the target table. A load with a changing schema often needs both.

### Transformations on the fly

Instead of a bare path you can put a `SELECT` over the path: that lets you cast columns, add `current_timestamp()` or `_metadata.file_path`, filter rows, all in a single command.

### Schemaless table

You can create a table **without a schema** with `CREATE TABLE IF NOT EXISTS t;` and let the first `COPY INTO` with `mergeSchema = 'true'` define it. This requires Databricks Runtime 11.3 LTS or later. On a schemaless table, `INSERT INTO` and `MERGE INTO` don't work until the first `COPY INTO` has populated it.

## Example

Incremental load of order CSVs from a volume, with schema evolution and audit columns:

```sql
CREATE TABLE IF NOT EXISTS shop.bronze.orders;

COPY INTO shop.bronze.orders
FROM (
  SELECT *, current_timestamp() AS ingested_at, _metadata.file_path AS source_file
  FROM '/Volumes/shop/landing/orders/'
)
FILEFORMAT = CSV
PATTERN = '*.csv'
FORMAT_OPTIONS ('header' = 'true', 'inferSchema' = 'true', 'mergeSchema' = 'true')
COPY_OPTIONS ('mergeSchema' = 'true');
```

The same command from Python, if you're in a notebook:

```python
spark.sql("""
  COPY INTO shop.bronze.orders
  FROM '/Volumes/shop/landing/orders/'
  FILEFORMAT = CSV
  PATTERN = '*.csv'
  FORMAT_OPTIONS ('header' = 'true', 'inferSchema' = 'true', 'mergeSchema' = 'true')
  COPY_OPTIONS ('mergeSchema' = 'true')
""")
```

Rerun an hour later, it loads only the CSVs that arrived in the meantime. If a file was corrupt, fix it and reload it with `COPY_OPTIONS ('force' = 'true')`, narrowing the set with `FILES`.

### COPY INTO or Auto Loader?

| | COPY INTO | Auto Loader |
| --- | --- | --- |
| Interface | SQL command | `cloudFiles` stream (Python or SQL streaming table) |
| State | tracked in the table | RocksDB checkpoint |
| Scale | up to thousands of files per directory | millions of files, file notification |
| Schema evolution | `mergeSchema` | configurable modes, `_rescued_data` |
| File discovery | listing on every run | incremental listing or notifications |
| When | few files, pure SQL, warehouse | high volumes, streaming or pipelines |

The docs are explicit: for directories that contain a very large number of files, prefer [[auto-loader]].

## Common mistakes

- Expecting `COPY INTO` to reload a **modified** file with the same name: the file counts as already loaded and gets skipped. You need `force` or a new file name.
- Using `force = 'true'` in a scheduled job "just to be safe": it duplicates data on every run.
- Forgetting `header = 'true'` on CSVs: the first row becomes a record.
- Putting `mergeSchema` only in `FORMAT_OPTIONS` and wondering why the table doesn't evolve.
- Running `COPY INTO` concurrently on the same set of files from two jobs: it only works on disjoint file sets.

> [!exam]
> The exam asks what makes `COPY INTO` **idempotent** (it skips already-loaded files), which option turns that off (`force`), which option enables schema evolution (`mergeSchema` in `COPY_OPTIONS`), and when to prefer it over Auto Loader (a few thousand files, SQL command, no checkpoint). Also remember the **schemaless table** pattern: created empty and filled by the first `COPY INTO`.
