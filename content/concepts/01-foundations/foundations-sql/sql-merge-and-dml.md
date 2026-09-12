---
id: sql-merge-and-dml
title: MERGE, UPDATE, DELETE on Delta
area: foundations-sql
level: intermediate
summary: MERGE INTO upserts and SCD-1, INSERT OVERWRITE versus REPLACE WHERE, and why Delta rewrites files instead of updating rows in place.
prerequisites: [delta-lake-overview, sql-joins-and-sets]
related: [medallion-architecture, liquid-clustering, sql-window-functions, gold-layer-objects]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/sql/language-manual/delta-merge-into
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/delta/selective-overwrite
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/delta/deletion-vectors
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/delta/delta-update
    checked: 2026-09-10
aliases: [merge into, upsert, scd1, replace where, insert overwrite, deletion vectors]
updated: 2026-09-10
status: published
---

## What it is

`MERGE INTO`, `UPDATE`, `DELETE`, and `INSERT OVERWRITE` are the statements that change data already sitting in a Delta table instead of just appending to it. They read like ordinary DML from any relational database, but Delta has no in-place row storage: every one of these statements works by writing new Parquet files and recording an atomic entry in the transaction log described in [[delta-lake-overview]], not by mutating bytes on disk.

## Why it exists

A medallion pipeline (see [[medallion-architecture]]) doesn't only append. Dimensions need corrections, CDC feeds need applying, and a full daily snapshot needs to replace yesterday's version of a table without a window where readers see half of each. `MERGE INTO` is the single statement that expresses "apply these changes, whatever they are" as one atomic operation.

## How it works

**MERGE INTO.** `MERGE INTO target USING source ON condition` followed by `WHEN MATCHED THEN UPDATE SET ...` (or `DELETE`), `WHEN NOT MATCHED THEN INSERT ...`, and optionally `WHEN NOT MATCHED BY SOURCE THEN UPDATE ...` (or `DELETE`) for target rows with no counterpart in the source at all - the clause that turns a merge into a full sync instead of a one-directional upsert. Each clause can carry its own extra `AND condition`. If more than one source row matches the same target row, the statement fails outright - source data needs deduplicating first, typically with the `QUALIFY` + `ROW_NUMBER()` pattern from [[sql-window-functions]].

**Upsert and SCD-1.** The common shape is `WHEN MATCHED THEN UPDATE SET *` plus `WHEN NOT MATCHED THEN INSERT *`: new keys get inserted, existing keys get overwritten with no history kept - Slowly Changing Dimension type 1. Adding `WHEN NOT MATCHED BY SOURCE THEN DELETE` turns the same statement into "the table should look exactly like the source", removing rows missing from today's extract.

**INSERT OVERWRITE vs REPLACE WHERE.** `INSERT OVERWRITE table` truncates the whole table (or, with a static partition spec, just the matching partitions) before writing new rows - blunt and all-or-nothing, and it breaks if the partitioning scheme changed since the data was written. `REPLACE WHERE predicate` instead deletes only rows matching an arbitrary predicate, not limited to partition columns, and inserts the new ones atomically; Databricks recommends it over static partition overwrite for most reprocessing jobs.

**UPDATE and DELETE.** Both accept a `WHERE` clause and read like standard SQL, but underneath, every Parquet file containing a matching row gets rewritten in full by default - changing one row in a 1 GB file rewrites the 1 GB file. **Deletion vectors** change that: matched rows are marked in a small metadata side-file instead, and readers apply the mark at query time, deferring the physical rewrite to a later `OPTIMIZE` or explicit `REORG TABLE ... APPLY (PURGE)`. That's what makes frequent row-level changes viable on tables with large files, especially paired with [[liquid-clustering]].

**Idempotency.** Re-running the same `MERGE INTO` twice with the same source produces the same end state, because it matches on a key instead of blindly appending - exactly why scheduled jobs prefer `MERGE`, `INSERT OVERWRITE`, or `REPLACE WHERE` over a plain `INSERT INTO`, which would duplicate every row on a retry.

**Why this isn't a row-store transaction.** Postgres updates a row by writing a new tuple version in place (MVCC), serializing concurrent writers with row and page locks, and can hold a transaction open across many statements. Delta has no row-level locking: concurrent writers race via optimistic concurrency on the transaction log, and one retries or fails on conflict. Each statement here is its own atomic commit, not a held-open, multi-statement transaction the way `BEGIN ... COMMIT` works in Postgres.

| | Databricks (Delta) | Postgres |
|---|---|---|
| Row update | new Parquet file (or deletion vector marker) | new tuple version, in place |
| Concurrency control | optimistic, at the transaction-log level | MVCC with row/page locks |
| Multi-statement transactions | one statement = one commit (DBSQL scripting adds more, recently) | native `BEGIN`/`COMMIT` blocks |
| Full-table refresh | `INSERT OVERWRITE` / `REPLACE WHERE` | `TRUNCATE` + `INSERT`, inside a transaction |
| Cost of a small `UPDATE` | scales with file size, unless deletion vectors are on | scales with rows changed |

## Example

```sql
MERGE INTO shop.silver.customers AS t
USING shop.bronze.customers_cdc AS s
ON t.customer_id = s.customer_id
WHEN MATCHED AND s.op = 'DELETE' THEN DELETE
WHEN MATCHED THEN UPDATE SET *
WHEN NOT MATCHED THEN INSERT *;

-- reprocess a single day without touching the rest of the table
INSERT INTO shop.gold.daily_revenue
REPLACE WHERE order_date = DATE'2026-09-09'
SELECT * FROM shop.silver.orders WHERE order_date = DATE'2026-09-09';

UPDATE shop.silver.customers SET status = 'inactive' WHERE last_seen < DATE'2025-01-01';
DELETE FROM shop.silver.customers WHERE customer_id IS NULL;
```

```python
from delta.tables import DeltaTable

target = DeltaTable.forName(spark, "shop.silver.customers")
source = spark.table("shop.bronze.customers_cdc")

(
    target.alias("t")
    .merge(source.alias("s"), "t.customer_id = s.customer_id")
    .whenMatchedDelete(condition="s.op = 'DELETE'")
    .whenMatchedUpdateAll()
    .whenNotMatchedInsertAll()
    .execute()
)
```

## Common mistakes

- Letting a `MERGE` fail with "multiple source rows matched" because the CDC staging table has duplicate keys - deduplicate with a window function first, not in the merge condition.
- Using static `INSERT OVERWRITE PARTITION` after the partitioning scheme changed, silently leaving stale data in partitions the new job no longer targets.
- Running frequent single-row `UPDATE`s on a table with large files and no deletion vectors, then wondering why a one-row change takes minutes.
- Treating a `MERGE` as something that can be partially rolled back mid-statement - it's one atomic commit or nothing, with no savepoints inside it.
- Forgetting `WHEN NOT MATCHED BY SOURCE` in a full-sync merge, so rows deleted at the source never get removed from the target.

> [!tip]
> Before writing a `MERGE`, ask whether the source can contain more than one row per key. If it can, deduplicate it with `QUALIFY ROW_NUMBER() ... = 1` first - the merge condition is not the place to solve that problem.
