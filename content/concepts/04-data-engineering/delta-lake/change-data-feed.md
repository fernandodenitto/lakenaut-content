---
id: change-data-feed
title: Change Data Feed
area: delta-lake
level: intermediate
summary: Change Data Feed records every row-level insert, update, and delete on a Delta table so downstream jobs can propagate just the change, not the whole table.
prerequisites: [delta-lake-overview, medallion-architecture]
related: [medallion-architecture, gold-layer-objects, structured-streaming-basics]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/delta/delta-change-data-feed
    checked: 2026-09-10
aliases: [CDF, table_changes, _change_type, _commit_version, readChangeFeed]
updated: 2026-09-10
status: published
---

## What it is

**Change Data Feed (CDF)** makes a Delta table (see [[delta-lake-overview]]) emit a row-level log of what changed on each write, not just the resulting state. Once enabled, every `INSERT`, `UPDATE`, `DELETE`, and `MERGE` is queryable as a stream of change records, each tagged with `_change_type`, `_commit_version`, and `_commit_timestamp`.

## Why it exists

Without CDF, propagating a change from one layer of the medallion (see [[medallion-architecture]]) to the next means either reprocessing the whole source table on every run, or hand-building your own audit columns and diffing logic to figure out what's new. Full reprocessing is simple and safe, but it doesn't scale: recomputing a multi-billion-row silver table to pick up a few thousand changed rows wastes most of the compute it uses. CDF gives you exactly the rows that changed, in the order they changed, without that cost.

## How it works

### Enabling it

```sql
ALTER TABLE main.silver.orders SET TBLPROPERTIES (delta.enableChangeDataFeed = true);
```

```sql
CREATE TABLE main.silver.orders (...)
TBLPROPERTIES (delta.enableChangeDataFeed = true);
```

CDF is off by default on a plain table; turning it on only affects writes made **after** that point — there's no way to retroactively generate change records for history that already happened.

### Reading changes

```sql
SELECT * FROM table_changes('main.silver.orders', 10, 20);
SELECT * FROM table_changes('main.silver.orders', '2026-09-01', '2026-09-05');
```

`table_changes` takes either a version range or a timestamp range and returns one row per change, decorated with the three metadata columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `_change_type` | string | `insert`, `update_preimage`, `update_postimage`, or `delete` |
| `_commit_version` | long | the table version the change belongs to |
| `_commit_timestamp` | timestamp | when that version was committed |

An `UPDATE` produces **two** rows: `update_preimage` (the row before) and `update_postimage` (the row after). Anything that just counts rows by `_change_type` without accounting for both will double-count updates.

### Reading CDF as a stream

```python
(spark.readStream
  .option("readChangeFeed", "true")
  .table("main.silver.orders"))
```

This turns the change feed itself into a Structured Streaming source (see [[structured-streaming-basics]]), which is what makes incremental propagation practical: the stream only ever delivers rows that are genuinely new since the last checkpoint.

### Incremental silver → gold propagation

The usual pattern reads the CDF stream from silver and applies it to gold with `foreachBatch`, using `_change_type` to decide the operation:

```python
def apply_changes(batch_df, batch_id):
    batch_df.createOrReplaceTempView("changes")
    batch_df.sparkSession.sql("""
        MERGE INTO main.gold.orders t
        USING (
          SELECT * FROM changes
          QUALIFY row_number() OVER (
            PARTITION BY order_id ORDER BY _commit_version DESC
          ) = 1
        ) s
        ON t.order_id = s.order_id
        WHEN MATCHED AND s._change_type = 'delete' THEN DELETE
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED AND s._change_type != 'delete' THEN INSERT *
    """)

(spark.readStream
  .option("readChangeFeed", "true")
  .table("main.silver.orders")
  .writeStream
  .foreachBatch(apply_changes)
  .option("checkpointLocation", "/Volumes/shop/streaming/_checkpoints/gold_orders")
  .trigger(availableNow=True)
  .start())
```

Keeping only the last change per key per batch (the `QUALIFY`) avoids applying an out-of-order sequence of updates to the same row within one micro-batch.

### Limits

Change data is only available from the version where CDF was turned on: there's no history before that point, and the usual retention settings (`delta.deletedFileRetentionDuration`, see [[delta-time-travel]]) apply to change files just as they do to data files, so old changes eventually age out too. CDF also isn't a replacement for the table itself — it's a log of transitions, not a snapshot you can query on its own for the current state.

### CDF vs. reprocessing everything

| | Reprocess the whole source | Change Data Feed |
| --- | --- | --- |
| Cost per run | scales with table size | scales with what changed |
| Correctness if you miss a run | self-healing, next run recomputes everything | needs the checkpoint to have seen every version in order |
| Setup | none | `delta.enableChangeDataFeed`, and downstream logic per `_change_type` |
| Good fit | small tables, infrequent runs, complex logic that's easier to express on the full data | large tables, frequent runs, simple propagate-the-change logic |

## Common mistakes

- Counting `_change_type = 'update_postimage'` rows as inserts, or not filtering out `update_preimage` from a simple downstream count.
- Expecting CDF to reconstruct changes from before it was enabled: it only sees what happens after that point.
- Never reconciling with a full recompute: a schema change or a bug in the propagation logic can drift gold away from silver over time in ways a change-only pipeline won't catch on its own.
- Leaving CDF enabled on a high-churn table without factoring in the extra storage: change files persist for the same retention window as the data they describe.

> [!tip]
> CDF earns its keep once "recompute everything" gets too slow or too expensive — for a small table or an infrequent batch job, plain `MERGE` against the full source is often simpler and just as correct.
