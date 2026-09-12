---
id: table-history-and-checkpoints
title: Table history and transaction log checkpoints
area: delta-lake
level: intermediate
summary: DESCRIBE HISTORY returns one row per modifying operation with its parameters and metrics, and the log behind it is folded into Parquet checkpoints so readers never replay every JSON commit.
prerequisites: [delta-lake-overview, delta-time-travel]
related:
  [
    delta-time-travel,
    delta-optimize-vacuum,
    predictive-optimization,
    deletion-vectors,
    system-tables,
  ]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/tables/history
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/tables/history-schema
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/delta/checkpoint-v2
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/delta-reorg-table
    checked: 2026-09-12
aliases:
  [
    DESCRIBE HISTORY,
    operationParameters,
    operationMetrics,
    checkpoint,
    checkpoint v2,
    _delta_log,
    logRetentionDuration,
    RESTORE,
  ]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

Every operation that modifies a Delta Lake or managed Iceberg table creates a new **version**, and `DESCRIBE HISTORY` returns one row per version in reverse chronological order, 14 columns wide. It is the table's own record of what happened to it: who ran what, from which job or notebook, at what isolation level, and how many rows and files moved.

[[delta-time-travel]] covers the other half of the story, reading and restoring earlier states. This page is about the log itself: what a version actually records, how to interpret it, and the mechanic that keeps a table with half a million commits readable.

## Why it exists

The immediate use is forensic. A table changed and nobody owns up; a nightly `MERGE` doubled its runtime; storage grew 40% in a week and no new data arrived. History answers all three, from the table itself rather than from monitoring somebody had to set up in advance.

The less visible reason is performance. The transaction log is also the read path: to plan a query, the engine has to know which files make up the current version. If that meant replaying every JSON commit from version 0, a busy streaming table would grind to a halt within days. Checkpoints are what stop that happening.

## How it works

### The columns worth knowing

| Column                            | Why you care                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `version`, `timestamp`            | the handle for `VERSION AS OF` and `RESTORE`                                                         |
| `userId`, `userName`              | who committed it                                                                                     |
| `operation`                       | `WRITE`, `MERGE`, `DELETE`, `UPDATE`, `OPTIMIZE`, `RESTORE`, `TRUNCATE`, `CONVERT` and so on         |
| `operationParameters`             | a map of what the command was asked to do, including which flavour of `OPTIMIZE` this was            |
| `operationMetrics`                | a map of what it actually did, in rows and files                                                     |
| `job`, `notebook`, `clusterId`    | provenance; `job` is populated only for commits from a Lakeflow job, `notebook` only from a notebook |
| `readVersion`                     | the version this write read to compute itself                                                        |
| `isolationLevel`, `isBlindAppend` | `WriteSerializable` or `Serializable`, and whether the write read anything first                     |
| `userMetadata`                    | commit metadata you set yourself                                                                     |

Some columns are unavailable when the write came through JDBC or ODBC, the REST API, or certain job task types, so history is not a complete audit trail. For that, use the audit and lineage [[system-tables]].

### Telling one OPTIMIZE from another

Auto compaction, liquid clustering, and a hand-run `OPTIMIZE` all appear as `operation = 'OPTIMIZE'`. The difference lives in `operationParameters`:

| Parameter   | Value                     | Meaning                                               |
| ----------- | ------------------------- | ----------------------------------------------------- |
| `auto`      | `true`                    | auto compaction fired automatically after a write     |
| `auto`      | `false`                   | a user or a scheduled job ran `OPTIMIZE`              |
| `clusterBy` | `["order_date","region"]` | incremental clustering on those keys                  |
| `clusterBy` | `[]`                      | file compaction only                                  |
| `zOrderBy`  | `["customer_id"]`         | Z-ordering was applied                                |
| `predicate` | `[]`                      | the operation covered the whole table                 |
| `predicate` | populated                 | a targeted `OPTIMIZE ... WHERE <partition predicate>` |

Predictive optimization shows up here too, as `OPTIMIZE` operations it queued (see [[predictive-optimization]] for the skip reasons that never reach history at all).

Do not read `partitionBy` the same way. It is only meaningful for `CREATE` and `OVERWRITE` operations that define or change the partition schema; on appends it may be `[]` or may list the partition columns depending on whether the write used `.save()` or `.saveAsTable()`. Either way the data lands in the right partitions, so it is not evidence of anything.

### Metrics that answer real questions

`operationMetrics` keys differ per operation. The ones that earn their keep:

- `WRITE`, `CREATE TABLE AS SELECT`, `COPY INTO`: `numFiles`, `numOutputRows`, `numOutputBytes`.
- `DELETE` and `UPDATE`: `numDeletedRows` or `numUpdatedRows`, plus **`numCopiedRows`**, the rows rewritten only because they shared a file with a changed row. That number is the case for [[deletion-vectors]] expressed in data.
- `MERGE`: `numSourceRows`, `numTargetRowsInserted`, `numTargetRowsUpdated`, `numTargetRowsDeleted`, `numTargetRowsCopied`, `numTargetFilesAdded`, `numTargetFilesRemoved`, and `scanTimeMs` against `rewriteTimeMs`.
- `OPTIMIZE`: `numRemovedFiles` in, `numAddedFiles` out, and the file size distribution as `minFileSize`, `p50FileSize`, `maxFileSize`.

### Checkpoints

The log is a directory of numbered JSON commit files alongside the data. Periodically, Databricks folds the accumulated versions into **Parquet checkpoint files**, so reconstructing the current state means reading the most recent checkpoint plus the handful of JSON commits after it rather than the entire history. Checkpoint frequency is tuned for data size and workload and is explicitly subject to change; there is nothing to configure and nothing to read directly.

There is one visible dial. **Checkpoint V2** supports more concurrent writers and cuts write conflicts on large or frequently updated tables. It reads and writes on Databricks Runtime 13.3 LTS and above, is the default for tables created with liquid clustering on Runtime 14.1 and above, and can be turned on by hand:

```sql
ALTER TABLE main.silver.orders SET TBLPROPERTIES ('delta.checkpointPolicy' = 'v2');
```

`ALTER TABLE main.silver.orders DROP FEATURE v2Checkpoint` goes back to classic checkpoints. On Runtime 16.3 and above, `REORG TABLE main.silver.orders APPLY (CHECKPOINT)` forces a checkpoint at the latest version, and it requires checkpoint V2, because without it a race condition can corrupt the table.

Checkpointing is also what lets log files be cleaned up: once versions are checkpointed, the JSON commits behind them are removed automatically.

### The two retention defaults

| Property                             | Default            | Controls                                                                                  |
| ------------------------------------ | ------------------ | ----------------------------------------------------------------------------------------- |
| `delta.logRetentionDuration`         | `interval 30 days` | how long history is kept, so how far back `DESCRIBE HISTORY` reaches                      |
| `delta.deletedFileRetentionDuration` | `interval 7 days`  | the threshold `VACUUM` uses to remove data files the current version no longer references |

Iceberg tables use the same names with an `iceberg.` prefix. Two newer rules tighten the relationship between them: on Databricks Runtime 18.0 and above, `logRetentionDuration` must be greater than or equal to `deletedFileRetentionDuration`, and a time travel query is rejected outright if it asks for a version older than `deletedFileRetentionDuration`. For Unity Catalog managed tables both rules apply from Runtime 12.2 and above. Raising one property without the other no longer half-works, it fails.

### RESTORE, and the stream downstream

`RESTORE TABLE <name> TO VERSION AS OF <n>` writes a new version whose contents match the one you picked. It needs `MODIFY`, works on an already-restored table and on a shallow clone, takes timestamps as `yyyy-MM-dd HH:mm:ss` or `yyyy-MM-dd`, and returns a single-row DataFrame of metrics including `num_restored_files` and `num_removed_files`.

The part that bites: restore log entries carry `dataChange = true`. A Structured Streaming job reading that table sees the restored files as new data and processes them again, so a restore can produce duplicates downstream. `OPTIMIZE` is the contrast: its entries carry `dataChange = false`, which is exactly why compaction does not feed anything into a stream.

## Example: finding out who is compacting a table

```sql
SELECT version, timestamp,
       operationParameters.auto          AS auto_compaction,
       operationParameters.clusterBy     AS cluster_by,
       operationParameters.zOrderBy      AS z_order_by,
       operationMetrics.numRemovedFiles  AS files_in,
       operationMetrics.numAddedFiles    AS files_out,
       operationMetrics.p50FileSize      AS median_file_size
FROM (DESCRIBE HISTORY main.silver.orders)
WHERE operation = 'OPTIMIZE'
ORDER BY version DESC;
```

```python
from delta.tables import DeltaTable

history = DeltaTable.forName(spark, "main.silver.orders").history()

# how much write amplification each MERGE paid for
(history.filter("operation = 'MERGE'")
   .selectExpr("version", "timestamp",
               "operationMetrics.numTargetRowsUpdated AS updated",
               "operationMetrics.numTargetRowsCopied  AS copied_along",
               "operationMetrics.numTargetFilesRemoved AS files_rewritten")
   .show(truncate=False))
```

A run with `auto_compaction = false`, an empty `cluster_by`, and a populated `z_order_by` is a legacy scheduled job doing a full rewrite every night, and the sign that the table belongs in [[data-layout-partitioning-zorder|the migration to clustering keys]].

## Common mistakes

- **Reading `operation = 'OPTIMIZE'` as "somebody ran `OPTIMIZE`".** Auto compaction and predictive optimization look identical until you check `operationParameters.auto` and `clusterBy`.
- **Raising `logRetentionDuration` and expecting older versions to become readable.** History and readability are separate. If `VACUUM` has removed the data files, a listed version is still dead.
- **Using history as the audit trail.** Writes through JDBC, ODBC, the REST API, and some job task types leave columns empty. Audit questions belong in system tables.
- **Restoring a table that feeds a Structured Streaming job** and then investigating the duplicates as a bug. Restore entries are data changes by design.
- **Deleting files from the log directory to reclaim space.** Checkpointing already removes what is no longer needed, and doing it by hand corrupts the table.
- **Trusting `partitionBy` on an append.** It is only meaningful when the partition schema was defined or changed.

> [!tip]
> `DESCRIBE HISTORY` wrapped in a subquery is a normal relation: `SELECT ... FROM (DESCRIBE HISTORY main.silver.orders) WHERE operation = 'MERGE'`. That one trick turns history from something you squint at in the UI into something you can filter, aggregate, and put on a dashboard.
