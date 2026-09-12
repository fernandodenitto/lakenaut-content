---
id: foreachbatch
title: Arbitrary sinks with foreachBatch
area: streaming
level: advanced
summary: foreachBatch hands each micro-batch to your own function as a batch DataFrame. It guarantees at-least-once, so exactly-once is something you build on batchId.
prerequisites: [structured-streaming-basics, delta-lake-overview]
related: [structured-streaming-basics, streaming-triggers, delta-lake-overview, sql-merge-and-dml, kafka-streaming, merge-upsert]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/structured-streaming/foreach
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/structured-streaming/delta-lake
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/structured-streaming/real-time/reference
    checked: 2026-09-11
aliases: [foreachBatch, batchId, txnAppId, txnVersion, idempotent writes, streaming merge, dead-letter queue]
updated: 2026-09-11
status: published
maturity: ga
---

## What it is

`foreachBatch` is the escape hatch in `writeStream`. Instead of naming a sink, you hand it a function with the signature `(df, batchId)`: `df` is the output of one micro-batch as an ordinary batch DataFrame, and `batchId` is the monotonically increasing number Structured Streaming assigns to that batch. Inside the function you write whatever you would write in a batch job.

That includes things a streaming plan cannot express incrementally. `MERGE INTO` against a Delta table is the classic one: there is no `merge` sink, so streaming upserts go through `foreachBatch` by definition.

## Why it exists

Streaming sinks and output modes are a small, fixed vocabulary, and plenty of real work falls outside it: applying a change feed as an upsert, writing the clean rows to one table and the rejects to another, pushing aggregates into an operational database, calling an HTTP endpoint. The predecessors were both bad. Staging to Delta and running a second batch job doubles the latency and the orchestration. `foreach`, the row-level equivalent, gives up every optimisation the DataFrame API has.

`foreachBatch` gives you the batch API inside the streaming loop, and hands you the one piece of bookkeeping you need to make retries safe: the batch id.

## How it works

### At-least-once, and what you do about it

This is the sentence to remember: **`foreachBatch` provides only at-least-once write guarantees.** The checkpoint protects the engine's own progress, not your function. If a batch fails halfway through, or the cluster dies after the sink write but before the commit, the same batch runs again with the same `batchId`.

So the contract you have to satisfy is: *for a given `batchId`, running the function twice must leave the world in the same state as running it once*. Everything below is a way of meeting that contract.

### Idempotent Delta writes: txnAppId and txnVersion

Delta tables give you this for free through two `DataFrameWriter` options:

| Option | What to pass |
| --- | --- |
| `txnAppId` | a unique string identifying the application; the streaming query id works, but any stable unique string does |
| `txnVersion` | a monotonically increasing transaction version, in practice the `batchId` |

Delta stores the pair and skips a write it has already seen, so a replayed batch is a no-op rather than a duplicate.

> [!warning]
> If you delete the checkpoint and restart with a new one, you **must** change `txnAppId`. A new checkpoint starts again at batch id `0`, and Delta keys on `txnAppId` plus batch id, so the first batches of the new run would be recognised as already applied and silently skipped.

### Streaming upserts with MERGE

For a merge there is nothing to bind a batch id to, so idempotency has to come from the merge condition itself: match on the business key and the statement is naturally repeatable.

One performance detail that is easy to miss: `merge` reads its input more than once, which multiplies the reported input data rate in `StreamingQueryProgress` and in the notebook rate graph. Cache the batch DataFrame before the merge and uncache it afterwards to stop the metric lying to you. (Note that `cache()` is not available on serverless compute, see [[serverless-compute]].)

### Empty batches are normal

Your function can be handed an empty DataFrame, and if it does not cope the query fails. With a Delta source this happens when `OPTIMIZE` runs with no files to compact (the table version still increments, producing an empty batch), and when predicate pushdown or file pruning removes every record at the physical plan level. One `if df.isEmpty(): return` at the top pays for itself.

### Consume the whole batch

With a stateful operator upstream, such as `dropDuplicatesWithinWatermark`, each call must consume the entire DataFrame or the query fails on the next batch. Code that peeks at the first rows (`df.show(2)`) and stops is the usual culprit; draining the rest with a no-op `foreach` fixes it.

### Let errors propagate

Databricks recommends failing fast and letting the orchestrator retry, rather than building retry loops inside the function, because a half-applied retry is how data gets duplicated. Roughly:

| Situation | What to do |
| --- | --- |
| transient sink error (connection timeout, HTTP 429) | catch: retry or route to a dead-letter queue |
| duplicate or key-constraint violation against an idempotent sink | catch: log and suppress |
| logic or schema errors, `NullPointerException`, `AttributeError` | propagate: let the query fail |
| `OutOfMemoryError`, corrupted state, data integrity violations | propagate: let the query fail |

### Where it does not work

- **Continuous processing mode**: `foreachBatch` is built on micro-batches, so it has nothing to hand you. Use `foreach`.
- **Real-time mode**: `forEachBatch` is not supported; `forEach` is. See [[streaming-triggers]].
- **Multiple sinks**: it works, but writes are serialised, which costs latency. Databricks recommends a separate streaming write per sink for parallelism, and reserving `foreachBatch` for cases where the writes genuinely have to happen together.

On compute with standard access mode from Databricks Runtime 14.0 onwards, `print()` goes to the driver logs, `dbutils.widgets` is unavailable inside the function, and anything the function references has to be serialisable.

## Example: clean rows and rejects, idempotently

Two tables written from one batch, both protected against replay:

```python
app_id = "orders-silver-v1"   # change this if you ever reset the checkpoint
checkpoint = "/Volumes/shop/streaming/_checkpoints/orders_silver"

def split_and_write(batch_df, batch_id):
    if batch_df.isEmpty():
        return

    valid = "amount > 0 AND customer_id IS NOT NULL"

    (batch_df.filter(valid).write.format("delta").mode("append")
        .option("txnAppId", app_id).option("txnVersion", batch_id)
        .saveAsTable("shop.silver.orders"))

    (batch_df.filter(f"NOT ({valid})").write.format("delta").mode("append")
        .option("txnAppId", app_id).option("txnVersion", batch_id)
        .saveAsTable("shop.silver.orders_rejected"))

(spark.readStream.table("shop.bronze.orders")
  .writeStream
  .option("checkpointLocation", checkpoint)
  .foreachBatch(split_and_write)
  .trigger(availableNow=True)
  .start())
```

A rejects table beats a failing query: valid data keeps flowing, and the bad records are there to inspect and reprocess. It is the streaming counterpart of the quarantine pattern in [[pipelines-expectations]].

The upsert variant, keyed on the business key rather than on `batchId` (see [[sql-merge-and-dml]] for the statement itself):

```python
def upsert_customers(batch_df, batch_id):
    if batch_df.isEmpty():
        return
    batch_df.cache()                       # merge reads the input more than once
    batch_df.createOrReplaceTempView("updates")
    batch_df.sparkSession.sql("""
        MERGE INTO shop.silver.customers t
        USING updates s ON t.customer_id = s.customer_id
        WHEN MATCHED AND s.op = 'delete' THEN DELETE
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
    """)
    batch_df.unpersist()
```

If the source can deliver two versions of the same key inside one batch, deduplicate to the latest row per key before the merge: `MERGE` refuses to update the same target row twice.

## Common mistakes

- **Assuming exactly-once because Structured Streaming says exactly-once.** The engine's guarantee stops at the checkpoint. `foreachBatch` is at-least-once, and the `batchId` is what you build the rest on.
- **Deleting the checkpoint without changing `txnAppId`.** Batch ids restart at `0`, Delta recognises them, and the first batches after the reset vanish without an error.
- **Not handling an empty DataFrame.** An `OPTIMIZE` on the source table with nothing to do is enough to produce one, and the query fails on something that is not a data problem.
- **Catching every exception and carrying on.** You get a query that reports success while dropping batches. Let logic and memory errors propagate and let the job retry.
- **Writing to four tables inside one `foreachBatch` for tidiness.** The writes serialise and every micro-batch pays for all four. Use one streaming query per sink unless they must commit together.
- **Merging without deduplicating the batch.** Two rows with the same key in one micro-batch make `MERGE` fail on multiple matches.

> [!tip]
> Before reaching for `foreachBatch`, check that a plain `toTable` sink plus the right output mode does not already do the job. When you do need it, write the function so it can be called twice with the same `batchId`, then test exactly that: rerun a batch by hand and confirm the row counts do not move.
