---
id: deletion-vectors
title: Deletion vectors
area: delta-lake
level: intermediate
summary: Deletion vectors record deleted and updated rows in metadata instead of rewriting whole Parquet files, and every reader applies them at scan time to work out which rows still count.
prerequisites: [delta-lake-overview, merge-upsert]
related:
  [
    delta-optimize-vacuum,
    merge-upsert,
    liquid-clustering,
    table-history-and-checkpoints,
    data-layout-partitioning-zorder,
  ]
exams:
  - cert: de-professional
    domain: "Cost & Performance Optimization"
    objective: "Understand Delta optimization techniques such as deletion vectors and liquid clustering."
sources:
  - url: https://docs.databricks.com/aws/en/tables/features/deletion-vectors
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/optimizations/isolation/row-level-concurrency
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/delta-reorg-table
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/delta/vacuum
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/admin/workspace-settings/deletion-vectors
    checked: 2026-09-12
aliases:
  [
    deletion vector,
    enableDeletionVectors,
    soft delete,
    merge-on-read,
    REORG TABLE,
    APPLY PURGE,
    row-level concurrency,
  ]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

**Deletion vectors** are a table feature, available on both Delta Lake and Apache Iceberg tables, that turns a row-level change into a metadata write. Without them, removing one row from a 500 MB Parquet file means reading that file, dropping the row, and writing a new 500 MB file. With them, Databricks writes a small side file recording which row positions in that data file no longer count, and leaves the data file untouched.

The consequence is that the Parquet file is no longer the whole truth. Every reader has to load the deletion vectors along with the file list and exclude the marked positions before returning rows, which is where the phrase "read-time resolution" comes from. The cost moves off the writer and onto the reader, where it is a bitmap check rather than a rewrite. `DELETE`, `UPDATE`, and `MERGE` all use them; an `UPDATE` is expressed as marking the old rows and appending the new ones.

## Why it exists

Copy-on-write punishes sparse changes. A right-to-be-forgotten job deleting 1,000 customer rows scattered across a 2 TB table can rewrite hundreds of gigabytes to remove a few kilobytes, and `DESCRIBE HISTORY` will tell you exactly how many rows were dragged along for the ride in `numCopiedRows` (see [[table-history-and-checkpoints]]). Slowly changing dimension merges have the same shape: small diffs, enormous rewrites.

The second problem was concurrency. Delta detects conflicts per file, so two `MERGE` jobs touching different customers whose rows happened to land in the same file failed on a concurrent-delete exception. Once a change is a metadata entry against a row position, conflict detection can work per row instead.

## How it works

### Turning them on

The property is per format, and this is the line to remember: Iceberg v3 tables include deletion vectors by default, Delta tables have to opt in.

```sql
-- Delta table
ALTER TABLE main.silver.customers
  SET TBLPROPERTIES ('delta.enableDeletionVectors' = true);

-- Managed Iceberg table, where the same feature is already on by default
ALTER TABLE main.silver.customers_iceberg
  SET TBLPROPERTIES ('iceberg.enableDeletionVectors' = true);
```

For Delta there is also a workspace default, the **Auto-Enable Deletion Vectors** setting under Settings, Advanced, which applies to tables created from SQL warehouses and Databricks Runtime 14.0 and above. Its options are `Disabled`, `New UC managed and Databricks SQL tables`, and `All new tables`. The `Default` value varies by region and will change meaning from off to `All new tables` once the rollout completes, so pick an explicit value.

Enabling the feature **upgrades the table protocol**, so clients that do not understand deletion vectors stop being able to read the table. From Databricks Runtime 14.1 you can reverse that with `ALTER TABLE <name> DROP FEATURE deletionVectors`. On materialized views and streaming tables the property can only be set at `CREATE TABLE` time, never with `ALTER`, and the protocol cannot be downgraded afterwards.

### Runtime floors

Reading needs less than writing, and without Photon each operation arrived separately.

| Client                            | Write                                                             | Read                                       |
| --------------------------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| Databricks Runtime with Photon    | `DELETE`, `UPDATE`, `MERGE` from 12.2 LTS                         | 12.2 LTS and above                         |
| Databricks Runtime without Photon | `DELETE` from 12.2 LTS, `UPDATE` from 14.1, `MERGE` from 14.3 LTS | 12.2 LTS and above                         |
| OSS Spark with OSS Delta Lake     | `DELETE` from Delta 2.4.0, `UPDATE` from Delta 3.0.0              | Delta 2.3.0 and above                      |
| OpenSharing recipient             | not supported                                                     | Runtime 14.1, or `delta-sharing-spark` 3.1 |

To write with every available optimisation, use Databricks Runtime 14.3 LTS and above. On Photon compute, deletion vectors are also what predictive I/O uses to accelerate updates.

### Row-level concurrency

Row-level concurrency is switched on automatically when three things hold: Databricks Runtime 14.3 LTS and above, the table has deletion vectors enabled, and **the table is not partitioned**. Under it, two concurrent `UPDATE`, `DELETE`, or `MERGE` statements conflict only when they modify the same row, not merely the same file.

Partitioned tables are excluded, which is one more argument for [[data-layout-partitioning-zorder|dropping partitions]] in favour of [[liquid-clustering]]. They do still get one benefit from deletion vectors: `OPTIMIZE` stops conflicting with concurrent writes, unless the `OPTIMIZE` uses `ZORDER BY`, which conflicts either way. The feature also falls back to file-level detection for conditions on structs, arrays, or maps, for non-deterministic expressions, and for subqueries, and row-level detection adds execution time, so under heavy concurrency the writer favours latency over resolving conflicts.

### Purging properly

A soft-deleted row is still physically in the Parquet file. Three things rewrite it: `OPTIMIZE`, a write with auto compaction that happens to touch that file, and `REORG TABLE ... APPLY (PURGE)`. Only the third is deliberate, because compaction gives no guarantee that every recorded change is applied when the affected file is not a compaction candidate.

A real purge is two commands with a wait between them, and the wait is the part people skip:

1. `REORG TABLE <name> APPLY (PURGE)` rewrites the files that contain soft-deleted data and commits a new version. The rows are gone from the current version, but the older versions still reference the original files.
2. `VACUUM` deletes those older files, and only once they have aged past `delta.deletedFileRetentionDuration`, which defaults to 7 days.

So a purge finishes a week after you ran it, unless you shorten the retention window and give up that much time travel. `REORG TABLE` needs Databricks Runtime 11.3 LTS and above, is idempotent, and accepts a `WHERE` clause on partition columns. On a large table set `spark.databricks.delta.reorg.purgeMode` to `rows`: the default, `all`, also scans every Parquet footer looking for dropped-column data.

## Example: a right-to-be-forgotten deletion

```sql
ALTER TABLE main.silver.customers
  SET TBLPROPERTIES ('delta.enableDeletionVectors' = true);

DELETE FROM main.silver.customers
WHERE customer_id IN (SELECT customer_id FROM main.ops.erasure_requests);

-- confirm what the commit actually did
SELECT version, operation, operationMetrics
FROM (DESCRIBE HISTORY main.silver.customers) LIMIT 1;

-- step 1: rewrite the files that hold the marked rows
SET spark.databricks.delta.reorg.purgeMode = rows;
REORG TABLE main.silver.customers APPLY (PURGE);

-- step 2, after delta.deletedFileRetentionDuration has elapsed
VACUUM main.silver.customers;
```

```python
from delta.tables import DeltaTable

requests = spark.table("main.ops.erasure_requests").select("customer_id")

(DeltaTable.forName(spark, "main.silver.customers").alias("c")
   .merge(requests.alias("r"), "c.customer_id = r.customer_id")
   .whenMatchedDelete()
   .execute())

spark.conf.set("spark.databricks.delta.reorg.purgeMode", "rows")
spark.sql("REORG TABLE main.silver.customers APPLY (PURGE)")
```

## Common mistakes

- **Treating `DELETE` as physical removal.** With deletion vectors the bytes are still in the file and still in older versions. A compliance deletion is not finished until `REORG ... APPLY (PURGE)` and then `VACUUM` have both run.
- **Running `VACUUM` immediately after `REORG`.** The files the purge superseded have not expired yet, so `VACUUM` removes nothing and the data stays.
- **Enabling them on a table an external engine reads.** The protocol upgrade locks out clients without deletion vector support, including Iceberg v2 readers. Check who reads the table first, or plan on `DROP FEATURE deletionVectors`.
- **Expecting row-level concurrency on a partitioned table.** It requires an unpartitioned table. Keeping the partitions and blaming the runtime for `MERGE` conflicts is the usual outcome.
- **Trying to `ALTER` a streaming table or materialized view onto deletion vectors.** It has to be done in the `CREATE TABLE` statement, and once done it cannot be undone.
- **Leaving `purgeMode` at `all` on a very large table.** Every Parquet footer gets scanned. Set it to `rows` when the table has no dropped columns.

> [!exam]
> The Professional guide names deletion vectors directly as a Delta optimisation technique. Know the mechanism (mark rows in metadata, resolve at read time, no file rewrite), the exact property names `delta.enableDeletionVectors` and `iceberg.enableDeletionVectors`, and that Iceberg v3 has them on by default while Delta does not. Know that reads need Databricks Runtime 12.2 LTS and writes with full optimisation need 14.3 LTS, that row-level concurrency requires 14.3 LTS plus deletion vectors plus **no partitions**, and that the purge sequence is `REORG TABLE ... APPLY (PURGE)` followed by `VACUUM` after the retention window, not `VACUUM` alone.
