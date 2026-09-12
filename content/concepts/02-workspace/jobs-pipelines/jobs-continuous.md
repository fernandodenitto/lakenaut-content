---
id: jobs-continuous
title: Continuous jobs
area: jobs-pipelines
subarea: jobs
level: intermediate
summary: "A continuous job keeps exactly one run alive, restarting it in under a minute when it ends and backing off exponentially when it keeps failing. On serverless, only bounded triggers work."
prerequisites: [jobs-overview, jobs-triggers]
related:
  [
    jobs-triggers,
    streaming-triggers,
    jobs-serverless,
    pipelines-overview,
    structured-streaming-basics,
  ]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/jobs/continuous
    checked: 2026-09-12
  - url: https://docs.databricks.com/api/workspace/jobs/create
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/compute/serverless/streaming
    checked: 2026-09-12
aliases:
  [
    continuous job,
    continuous mode,
    always-on job,
    task retry mode,
    exponential backoff,
    restart run,
  ]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

**Continuous mode** is the trigger family in [[jobs-triggers]] that does not wait for anything. Instead of starting a run at a time or on an event, the scheduler keeps one run alive: when the run ends, for whatever reason, a new run starts. Databricks recommends it for always-on streaming workloads.

In the API it is a `continuous` object on the job, with two fields: `pause_status` (`UNPAUSED` or `PAUSED`, defaulting to `UNPAUSED`) and `task_retry_mode`. Only one of `schedule` and `continuous` can be set on a job.

It also replaces an older recipe. The legacy recommendation for a [[structured-streaming-basics|Structured Streaming]] job was to configure an unlimited retry policy with a maximum of one concurrent run. Continuous mode is that behaviour built into the scheduler, and the two are not meant to be combined: a continuous job cannot use retry policies at all.

## Why it exists

A streaming query that dies at three in the morning over a transient storage error should be back within a minute, without anybody being paged. Getting that from ordinary job settings was awkward. Unlimited retries kept the _same_ run alive, so the run history was one entry that never ended and no clean view of how often the thing fell over, and a genuinely broken dependency turned into a retry loop hammering it every few seconds.

Continuous mode separates the two failure shapes. A run that ends cleanly restarts almost immediately, because that is the normal case for a bounded batch. A run that keeps failing gets progressively longer gaps, so a broken upstream does not become a denial-of-service against itself, and the job returns on its own once the upstream recovers.

## How it works

### Exactly one run, and a gap under a minute

There can be only one running instance of a continuous job. Between one run finishing and the next starting there is a delay, which the documentation says should be less than 60 seconds. Two consequences follow from the single-instance rule and are worth stating plainly: **task dependencies are not supported** in a continuous job, and **retry policies are not supported** either.

### Two levels of retry

| Level | Setting                                               | Behaviour                                                                                                                                                                                             |
| ----- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task  | `continuous.task_retry_mode`: `NEVER` or `ON_FAILURE` | a failed task is retried with an exponentially increasing delay, up to a maximum of **three** retries for a single-task job. Once those are exhausted the run is cancelled and a new run is triggered |
| Job   | always active, nothing to configure                   | consecutive failures across runs back off exponentially                                                                                                                                               |

Note the default disagreement: the API documents `task_retry_mode` as defaulting to `NEVER`, while the Jobs UI defaults it to **On failure** when you pick continuous mode. Set it explicitly in your bundle rather than inheriting whichever default your path happens to give you.

For a job with several tasks, a failed task triggers a new run when no other task is still running, or when every other unfinished task is also failed or retrying.

### The job-level backoff, and when it resets

Once a continuous job passes the allowable threshold for consecutive failures:

1. the job is restarted after a retry period set by the system;
2. if that run also fails, the retry period increases and the job restarts after the new, longer period;
3. each further failure lengthens the period again, up to a maximum retry period set by the system, after which the job keeps retrying at that maximum. There is no limit on the number of retries;
4. the sequence resets when a run completes successfully and starts a new run, or when a run lasts past a threshold without failing. At that point the job is considered healthy again.

Be clear about what the documentation does not say: the consecutive-failure threshold, the first retry period, the maximum retry period and the healthy-run threshold are all "set by the system" and no numbers are published. Do not write a runbook that assumes a restart within N minutes. If you need the job back now, restart it from the Jobs UI or pass the job id to the `run-now` request in the Jobs API, which works on a job sitting in the backoff state.

### Pausing, and picking up a new configuration

**Pause** stops a continuous job; **Resume** puts it back into continuous mode. **Run now** on a paused continuous job triggers a single run, which is the cheapest way to test a change.

The running run does not notice that you redeployed. To make a continuous job pick up an updated configuration, click **Restart run** or pass the job id to `run-now`. A `databricks bundle deploy` updates the definition and leaves the in-flight run on the old one, which is a good way to spend twenty minutes wondering why your fix did nothing.

### Serverless supports bounded triggers only

This is the constraint that decides the architecture. A continuous schedule on [[jobs-serverless|serverless compute]] works with **bounded** Structured Streaming triggers such as `Trigger.AvailableNow`: the task drains what has arrived, exits, and the scheduler starts it again, with the streaming checkpoint guaranteeing nothing is reprocessed. Time-based triggers, `Trigger.ProcessingTime` and `Trigger.Continuous`, are **not supported** on serverless compute. See [[streaming-triggers]] for what each trigger does and what it costs.

So on serverless, a continuous job is a tight loop of bounded batches, and its latency floor is the length of one batch plus the restart gap, not the sub-second latency of an always-on query. If you need genuinely continuous low-latency streaming on serverless, the documented answer is a Lakeflow pipeline in continuous mode, not a continuous job (see [[pipelines-overview]]).

### Pipelines inherit the continuous-ness

One more inheritance rule that surprises people: a pipeline started by a continuous job also runs continuously, regardless of its own pipeline mode setting. You cannot keep a triggered pipeline triggered by launching it from a continuous job.

## Example: an always-on stream, and its serverless equivalent

Two jobs in a bundle. The first holds a classic cluster and an open Kafka stream; the second loops bounded batches on serverless.

```yaml
resources:
  jobs:
    orders_stream:
      name: orders_stream
      continuous:
        pause_status: UNPAUSED
        task_retry_mode: ON_FAILURE # three task retries, then the run is cancelled and restarted
      max_concurrent_runs: 1
      job_clusters:
        - job_cluster_key: stream
          new_cluster:
            spark_version: 16.4.x-scala2.12
            node_type_id: m5.xlarge
            num_workers: 2
      tasks:
        - task_key: ingest # exactly one task: continuous jobs have no dependencies
          job_cluster_key: stream
          notebook_task:
            notebook_path: ../src/orders_stream.py

    orders_incremental:
      name: orders_incremental
      continuous:
        pause_status: UNPAUSED
      tasks:
        - task_key: ingest # no compute declared, so serverless
          notebook_task:
            notebook_path: ../src/orders_available_now.py
```

The classic task runs a query that never returns, so the run stays alive until something breaks:

```python
(spark.readStream.format("kafka")
  .option("kafka.bootstrap.servers", "broker1:9092")
  .option("subscribe", "orders")
  .load()
  .writeStream
  .option("checkpointLocation", "/Volumes/main/streaming/_checkpoints/orders_kafka")
  .trigger(processingTime="10 seconds")   # not available on serverless
  .toTable("main.bronze.orders_kafka"))
```

The serverless task does the opposite. It exits on purpose, and the continuous schedule is what brings it back:

```python
checkpoint = "/Volumes/main/streaming/_checkpoints/orders_files"

(spark.readStream.format("cloudFiles")
  .option("cloudFiles.format", "json")
  .option("cloudFiles.schemaLocation", checkpoint)
  .load("s3://shop-landing/orders/")
  .writeStream
  .option("checkpointLocation", checkpoint)
  .trigger(availableNow=True)            # drains the backlog, then the run ends
  .toTable("main.bronze.orders_files"))
```

Same guarantees, different latency. The first is seconds; the second is one batch plus up to a minute of restart gap, on compute that only exists while work is running.

## Common mistakes

- **Setting a retry policy on a continuous job.** `max_retries` is not supported here. The job-level exponential backoff is the retry mechanism, and task retries come from `task_retry_mode`.
- **Designing a DAG and then making it continuous.** Task dependencies do not work. An always-on multi-step flow belongs in a Lakeflow pipeline, or in one task that owns the whole query.
- **Using `processingTime` in a serverless continuous job.** Only bounded triggers are supported. Use `availableNow`, or move to a continuous Lakeflow pipeline.
- **Deploying a fix and waiting.** The in-flight run keeps the old configuration until Restart run or `run-now`.
- **Alerting on an assumed backoff interval.** The thresholds and retry periods are not published. Alert on run outcomes instead, and restart explicitly when you need to.
- **Running a two-second batch on a five-minute cluster.** Keep the task short-lived and serverless, or long-lived and classic, because every restart pays the startup again.

> [!tip]
> Reach for continuous mode when the work genuinely never ends and one instance is the right number. If the source is files or a table and minute-level freshness is acceptable, a scheduled job running `availableNow` is simpler to reason about and cheaper; the continuous restart loop earns its keep when the gap between batches matters more than the compute bill.
