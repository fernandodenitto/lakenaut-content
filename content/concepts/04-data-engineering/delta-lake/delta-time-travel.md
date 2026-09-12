---
id: delta-time-travel
title: Time travel and table history
area: delta-lake
level: beginner
summary: DESCRIBE HISTORY, VERSION AS OF, and RESTORE let you inspect and recover earlier states of a Delta table, within the limits of log and file retention.
prerequisites: [delta-lake-overview, managed-vs-external-tables]
related: [delta-lake-overview, delta-optimize-vacuum, gold-layer-objects]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/delta/history
    checked: 2026-09-10
aliases: [DESCRIBE HISTORY, VERSION AS OF, TIMESTAMP AS OF, RESTORE TABLE, table history]
updated: 2026-09-10
status: published
---

## What it is

Every write to a Delta table (see [[delta-lake-overview]]) becomes a numbered **version** in the transaction log. Time travel is the ability to query, or restore, the table as it looked at any past version or timestamp, as long as the pieces that version needs — the log entry and the data files it points to — are still around.

## Why it exists

Two everyday needs drive this: recovering from a mistake (a bad `DELETE`, a job that ran twice, a wrong `MERGE`) without reaching for a backup, and reproducing a past result on demand — "what did this table look like when the report ran on Monday," or "what did the model train on." Both are just queries against an older version, not special operations.

## How it works

### DESCRIBE HISTORY

```sql
DESCRIBE HISTORY main.silver.orders;
DESCRIBE HISTORY main.silver.orders LIMIT 10;
```

One row per version, newest first: `version`, `timestamp`, `userName`, `operation` (`WRITE`, `MERGE`, `DELETE`, `RESTORE`, `OPTIMIZE`…), `operationParameters`, and `operationMetrics` (rows written, rows deleted, files added). It's the first thing to check when a table changed and you don't know why.

### Reading a past version

```sql
SELECT * FROM main.silver.orders VERSION AS OF 40;
SELECT * FROM main.silver.orders TIMESTAMP AS OF '2026-09-01T00:00:00Z';
```

```python
spark.read.option("versionAsOf", 40).table("main.silver.orders")
spark.read.option("timestampAsOf", "2026-09-01").table("main.silver.orders")
```

These are ordinary, read-only queries: they don't change the table's current state, and you can join or compare them against the live version.

### RESTORE

```sql
RESTORE TABLE main.silver.orders TO VERSION AS OF 40;
```

`RESTORE` doesn't erase anything: it reads the chosen version and writes a **new** version identical to it, reporting metrics such as files restored and files removed. The version you restored *from* stays in the log, alongside the bad version you're restoring *away from* — useful if you need to investigate what went wrong later.

### Retention: what keeps time travel working

Two table properties, independent of each other, decide how far back you can actually go:

| Property | Default | Controls |
| --- | --- | --- |
| `delta.logRetentionDuration` | 30 days | how long log entries (and `DESCRIBE HISTORY` rows) are kept |
| `delta.deletedFileRetentionDuration` | 7 days | how long data files no longer needed by the latest version are kept on disk |

A version is only queryable if **both** hold: the log still has its entry, and the files it references haven't been physically removed. Since the file retention default (7 days) is shorter than the log retention default (30 days), a table under normal maintenance can show a version in `DESCRIBE HISTORY` that's no longer actually readable.

### Why VACUUM breaks it

`VACUUM` (see [[delta-optimize-vacuum]]) deletes files older than the retention window that no live version needs. Once that happens, any version that depended on those files stops being queryable, even though its log entry may still exist. Time travel is a recovery tool for recent mistakes, not an archive.

## Example

An overnight job deletes the wrong rows:

```sql
DESCRIBE HISTORY main.silver.clients LIMIT 3;
-- version 41: DELETE, 120000 rows removed, userName job-etl

SELECT count(*) FROM main.silver.clients VERSION AS OF 40;
RESTORE TABLE main.silver.clients TO VERSION AS OF 40;
```

```python
spark.read.option("versionAsOf", 40).table("main.silver.clients").count()
spark.sql("RESTORE TABLE main.silver.clients TO VERSION AS OF 40")
```

Version 42 is now identical to 40; version 41, the mistake, stays in the log for the post-mortem.

## Common mistakes

- Treating time travel as a backup strategy: after `VACUUM` runs, the files are gone and the version is unreadable regardless of what `DESCRIBE HISTORY` still lists.
- Raising only `deletedFileRetentionDuration` and forgetting `logRetentionDuration` (or the other way around) when a longer audit window is the actual goal — both need to move together.
- Expecting `RESTORE` to delete the versions that came after it: it adds one version, it never rewrites history.
- Confusing a read against `VERSION AS OF` (no effect on the table) with `RESTORE` (changes the current state).
- Lowering `deletedFileRetentionDuration` to save storage without checking whether anything — a long-running query, a downstream time-travel read — depends on the window being wider.

> [!tip]
> `DESCRIBE HISTORY` first, always: it tells you exactly which version to target before you read it with `VERSION AS OF` or commit to a `RESTORE`. Guessing a version number is how you restore the wrong thing.
