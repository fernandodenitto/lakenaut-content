---
id: streaming-triggers
title: Trigger intervals in Structured Streaming
area: streaming
level: intermediate
summary: The trigger decides when a streaming query looks for new data. Default, processingTime, availableNow and realTime, and what each one costs you.
prerequisites: [structured-streaming-basics]
related: [structured-streaming-basics, jobs-triggers, kafka-streaming, foreachbatch, serverless-compute]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/structured-streaming/triggers
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/structured-streaming/real-time/concepts
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/structured-streaming/real-time/setup
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/structured-streaming/real-time/reference
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/compute/serverless/limitations
    checked: 2026-09-11
aliases: [trigger, availableNow, Trigger.Once, processingTime, realTime, real-time mode, continuous trigger]
updated: 2026-09-11
status: published
maturity: ga
---

## What it is

The **trigger** is the single setting on `writeStream` that decides *when* a streaming query goes looking for new data and how long a micro-batch is allowed to run. It says nothing about *how much* data ends up in a batch: that is the job of source-side limits like `maxFilesPerTrigger`, `maxBytesPerTrigger` or `maxOffsetsPerTrigger`.

Databricks supports four trigger modes. Three of them run the micro-batch loop described in [[structured-streaming-basics]] at different cadences; the fourth, real-time mode, changes the execution architecture underneath.

Do not confuse this with a **job** trigger. [[jobs-triggers]] decides when a *run* starts; the streaming trigger decides what happens inside that run once the query is going.

## Why it exists

Latency and cost are the same dial, and the trigger is the handle on it. If you set nothing, Structured Streaming picks `processingTime` with an interval of `0`, which means it checks the source every few milliseconds. Against cloud object storage that turns into a large number of storage API calls per day, and Databricks warns explicitly that this can produce unexpected charges from your cloud provider. The bill arrives from the storage service, not from Databricks, which is why nobody sees it coming.

Having the trigger as a separate setting also means the same query serves two very different deployments. The transformation you wrote for a 30-second stream runs unchanged as an hourly batch: you change one line and schedule it from a job.

## How it works

### The modes, and the one that is not supported

| Mode | Syntax | What it does |
| --- | --- | --- |
| **Unspecified** (default) | none | equivalent to `processingTime` with a 0 ms interval; general-purpose streaming with 3 to 5 second latency, running as long as data keeps arriving |
| **processingTime** | `.trigger(processingTime='10 seconds')` | fixed-interval micro-batches; the interval sets how often the query checks for new data |
| **availableNow** | `.trigger(availableNow=True)` | consumes everything available when the query starts, as one or more incremental batches, then stops |
| **realTime** | `.trigger(realTime='5 minutes')` | one long-running batch of the stated length, processing records as they arrive |
| **continuous** | `.trigger(continuous='1 second')` | the experimental Spark open-source mode. **Not supported on Databricks**; use real-time mode instead |

Note what `realTime='5 minutes'` means: the string is the length of the long-running batch, not a latency target. A longer batch amortises per-batch overhead such as query compilation, but checkpointing happens between batches, so it also means slower replay after a failure and later metrics.

### availableNow, and the death of Trigger.Once

In Databricks Runtime 11.3 LTS and above, `Trigger.Once` is deprecated in favour of `Trigger.AvailableNow` for all incremental batch workloads. The difference matters: `Trigger.Once` processed the backlog as a single batch, which is how people ran a machine out of memory after a long weekend. `availableNow` splits the same backlog into several batches and honours the source's sizing options, so a large catch-up is bounded.

Support arrived source by source, and the minimum runtime differs:

| Source | Minimum Databricks Runtime |
| --- | --- |
| File sources (JSON, Parquet, and so on) | 9.1 LTS |
| Delta Lake | 10.4 LTS |
| Auto Loader | 10.4 LTS |
| Apache Kafka | 10.4 LTS |
| Kinesis | 13.1 |
| OpenSharing | 18.0 |

### Real-time mode

Real-time mode targets end-to-end latency under one second at the tail, commonly around 300 ms, for operational work such as fraud scoring. It buys that by scheduling every stage of the query at once and passing records between stages through a streaming shuffle instead of a batch boundary. The price is a long list of requirements:

- **classic compute only**: dedicated or standard access mode, standard being Python only. Serverless is not supported, and neither is Lakeflow pipelines as a Structured Streaming query (pipelines have their own real-time setting);
- **Databricks Runtime 16.4 LTS and above**, and 18 LTS and above for stream-to-stream inner joins;
- autoscaling off, Photon off, spot instances off;
- `spark.databricks.streaming.realTimeMode.enabled` set to `true`;
- **update** output mode only, so `append` and `complete` are out;
- enough task slots for every stage at once: a Kafka source with `maxPartitions = 8` feeding a shuffle of 20 partitions needs 28 slots, not 8.

Delta is supported neither as a source nor as a sink, and `foreachBatch` does not work at all (see [[foreachbatch]]); `foreach` does. In practice real-time mode is a Kafka-in, Kafka-out tool.

### Serverless allows one trigger

On serverless compute, only `Trigger.AvailableNow()` is supported, plus the deprecated `Trigger.Once()`. Anything else, including `processingTime` and the unspecified default, fails with `INFINITE_STREAMING_TRIGGER_NOT_SUPPORTED`. If you need something continuous on serverless, the options are a Lakeflow pipeline in continuous mode or a continuously scheduled job running `availableNow`. See [[serverless-compute]].

### Changing the trigger between runs

You can change the trigger and keep the same checkpoint. A micro-batch that was in flight when the query stopped finishes under the old setting first, so expect one transitional batch. What a trigger change will not do is rescue a failed batch: Structured Streaming requires idempotent micro-batches, so the previous unsuccessful batch has to complete. Add capacity instead.

## Example: always-on versus hourly

Same transformation, two deployments. The always-on version:

```python
checkpoint = "/Volumes/shop/streaming/_checkpoints/orders_silver"

(spark.readStream.table("shop.bronze.orders")
  .where("amount > 0")
  .writeStream
  .option("checkpointLocation", checkpoint)
  .trigger(processingTime="30 seconds")   # compute stays up all day
  .toTable("shop.silver.orders"))
```

The incremental-batch version, which is the same code with one line changed, scheduled hourly from a job:

```python
(spark.readStream.table("shop.bronze.orders")
  .where("amount > 0")
  .writeStream
  .option("checkpointLocation", checkpoint)   # same checkpoint, no reprocessing
  .trigger(availableNow=True)                 # drains the backlog, then exits
  .toTable("shop.silver.orders"))
```

Now count the compute. The first query holds a cluster for 24 hours a day, roughly **720 compute-hours a month**. The second runs 24 times a day; if each run takes four minutes including startup, that is 96 minutes a day, roughly **48 compute-hours a month**. Fifteen times less compute for the same rows, and the only thing you gave up is freshness: worst case moves from 30 seconds to one hour.

That trade is the whole decision. Ask what the consumer does with the data. A dashboard refreshed every morning does not need a 30-second stream. A fraud check does, and if it needs better than a second, it needs real-time mode and the classic cluster that comes with it.

## Common mistakes

- **Leaving the trigger unset "for now".** The default is not "off", it is a 0 ms interval polling the source continuously. On object storage the storage API calls are the part of the bill you did not budget for.
- **Still writing `Trigger.Once`.** It has been deprecated since Databricks Runtime 11.3 LTS, and it processes a backlog in one batch, which is exactly how catch-up runs die. Use `availableNow`.
- **Reaching for `.trigger(continuous=...)` after reading the Apache Spark documentation.** Continuous processing is experimental in Spark and not supported on Databricks; real-time mode is the supported answer.
- **Reading `realTime='5 minutes'` as "latency of five minutes".** It is the batch length. Latency is sub-second; the interval controls checkpoint frequency and per-batch overhead.
- **Planning real-time mode on serverless.** It needs classic compute with Photon and autoscaling turned off. Budget for a dedicated cluster or pick another mode.
- **Changing the trigger to get past a failing batch.** The failed batch still has to complete. Give the query more compute instead.

> [!tip]
> Start from `availableNow` in a scheduled job and only move up the dial when somebody can name the consumer that needs the extra freshness. `processingTime` is the middle ground when a job schedule is too coarse but a second of latency is fine. Real-time mode is a different product with its own cluster requirements, not a trigger you flip on.
