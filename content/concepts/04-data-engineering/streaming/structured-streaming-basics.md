---
id: structured-streaming-basics
title: Structured Streaming on Databricks
area: streaming
level: intermediate
summary: Structured Streaming treats a data stream as a table that keeps growing, processed in repeated micro-batches with readStream/writeStream, triggers, and checkpoints.
prerequisites: [auto-loader, delta-lake-overview]
related: [streaming-watermarks-state, jobs-triggers, pipelines-overview, gold-layer-objects]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/structured-streaming/
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/structured-streaming/triggers
    checked: 2026-09-10
aliases: [readStream, writeStream, micro-batch, real-time mode, foreachBatch]
updated: 2026-09-10
status: published
---

## What it is

**Structured Streaming** is Spark's model for incremental processing: a stream is an unbounded table that keeps getting new rows appended to it, and a streaming query is a regular DataFrame query that Spark re-runs, incrementally, every time new rows show up. You write the same `select`, `filter`, `groupBy` you'd write for a batch job; the engine figures out what changed since the last run and processes only that.

## Why it exists

Before this model, streaming meant tracking offsets by hand and reasoning about partial failures record by record, using an API different from batch jobs. Structured Streaming reuses the DataFrame API, so batch and streaming logic can share the same transformations, and it handles fault tolerance and exactly-once bookkeeping for you through the **checkpoint**.

## How it works

### The micro-batch model

By default, a streaming query runs as a loop: check the source for new data, process it as a **micro-batch**, write the result, record progress in the checkpoint, repeat. There's no fixed batch size unless you set one; the engine grabs whatever arrived since the last cycle.

### Sources and sinks

Common sources: Auto Loader (`cloudFiles`, see [[auto-loader]]), a Delta table via `spark.readStream.table(...)`, Kafka, Kinesis. Common sinks: a Delta/Unity Catalog table via `writeStream.toTable(...)`, `foreachBatch` for arbitrary logic, message queues. Delta as both source and sink is what makes chained bronze → silver → gold streaming pipelines possible.

### Output modes

| Mode | What gets written each micro-batch | Typical use |
| --- | --- | --- |
| `append` (default) | only new rows | row-level transformations, no aggregation |
| `update` | rows whose aggregate changed | aggregations where you only care about the latest value per key |
| `complete` | the entire result table | small aggregations where downstream needs the full picture every time |

`append` is the only mode allowed for plain, non-aggregated queries; `complete` gets expensive fast because it rewrites everything on every trigger.

### Triggers

| Trigger | Syntax | Behavior |
| --- | --- | --- |
| Default | none | runs continuously, checking for new data as soon as the previous micro-batch finishes |
| Fixed interval | `.trigger(processingTime="1 minute")` | waits out the interval even if the previous batch finished early |
| Incremental batch | `.trigger(availableNow=True)` | processes everything currently available, then stops; replaces the deprecated `Trigger.Once` |
| Real-time mode | `.trigger(realTime="5 minutes")` | sub-second, often around 300 ms, end-to-end latency for low-latency operational workloads; the parameter bounds micro-batch length, not the latency itself |

`availableNow` is what turns a stream into a scheduled job: run it from Lakeflow Jobs on a cron trigger (see [[jobs-triggers]]) instead of leaving a cluster up all day.

### Checkpoints

A checkpoint (`checkpointLocation`) stores what the query needs to resume where it left off: offsets already processed, a write-ahead log of commits, and, for stateful queries, the state store itself. Losing or swapping the checkpoint means Spark no longer knows what it processed — it either reprocesses everything or continues from the wrong place.

### Exactly-once and idempotent sinks

The checkpoint gives Spark **exactly-once processing** on its own side: it never loses or double-counts a micro-batch internally. Whether that guarantee reaches the sink depends on the sink itself. A Delta table write is idempotent by construction, so retries after a failed batch are safe. A sink without native transaction support (a REST API, an email) needs you to make the write idempotent, typically by keying on the batch id and skipping batches already applied.

### foreachBatch

`foreachBatch` hands you the micro-batch as a plain DataFrame plus a batch id, for logic the built-in sinks don't support: writing to multiple tables, running a `MERGE`, calling an external system.

## Example

```python
checkpoint = "/Volumes/shop/streaming/_checkpoints/orders"

stream = (spark.readStream.table("shop.bronze.orders_raw")
  .writeStream
  .option("checkpointLocation", checkpoint)
  .trigger(processingTime="30 seconds")
  .outputMode("append")
  .toTable("shop.silver.orders"))
```

The declarative equivalent inside a pipeline (see [[pipelines-overview]]):

```sql
CREATE OR REFRESH STREAMING TABLE shop.silver.orders
AS SELECT * FROM STREAM shop.bronze.orders_raw;
```

Idempotent upsert with `foreachBatch`:

```python
def upsert(batch_df, batch_id):
    (batch_df.createOrReplaceTempView("updates"))
    batch_df.sparkSession.sql("""
        MERGE INTO shop.gold.orders t
        USING updates s ON t.order_id = s.order_id
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
    """)

(spark.readStream.table("shop.silver.orders")
  .writeStream
  .option("checkpointLocation", checkpoint + "_gold")
  .foreachBatch(upsert)
  .trigger(availableNow=True)
  .start())
```

## Common mistakes

- Pointing two different streaming queries at the same `checkpointLocation`: offsets and state get mixed up.
- Using `complete` output mode for a large aggregation: every trigger rewrites the whole result.
- Writing to a non-transactional sink inside `foreachBatch` without deduplicating on batch id: a retried batch gets applied twice.
- Treating the deprecated `Trigger.Once` as still the right choice: `availableNow` supersedes it and processes data in multiple batches when there's a lot of it.
- Forgetting that the default trigger runs forever: on a job cluster this leaves compute running with nothing new to do.

> [!tip]
> `append` + `availableNow` + a Delta sink covers most batch-like streaming jobs. Reach for `foreachBatch` only when the built-in sinks and output modes genuinely can't express what you need — it gives full control but also full responsibility for idempotency.
