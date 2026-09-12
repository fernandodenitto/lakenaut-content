---
id: jobs-queue-and-concurrency
title: "Concurrent runs, queueing, and the limits behind them"
area: jobs-pipelines
subarea: jobs
level: intermediate
summary: max_concurrent_runs defaults to 1 and caps at 1000. With queueing on, a run that hits one of three limits waits up to 48 hours instead of being skipped. The exact numbers are what the exam asks about.
prerequisites: [jobs-overview, jobs-triggers]
related: [jobs-repair-runs, jobs-control-flow, runs-monitoring, jobs-task-dependencies]
exams:
  - cert: de-associate
    domain: "Working with Lakeflow Jobs"
    objective: "Configure how many runs of a job can be active at once, and decide whether an over-limit run is queued or skipped."
sources:
  - url: https://docs.databricks.com/aws/en/jobs/configure-job
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/resources/limits
    checked: 2026-09-12
  - url: https://docs.databricks.com/api/workspace/jobs/create
    checked: 2026-09-12
  - url: https://docs.databricks.com/api/workspace/jobs/getrun
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/jobs/continuous
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/admin/system-tables/jobs
    checked: 2026-09-12
aliases:
  [
    max_concurrent_runs,
    maximum concurrent runs,
    queue,
    queueing,
    queued run,
    skipped run,
    MAXIMUM_CONCURRENT_RUNS_REACHED,
    concurrency limits,
  ]
updated: 2026-09-12
status: published
---

## What it is

Two settings decide what happens when a job is asked to start while it is already busy, or while the workspace is already full.

**Maximum concurrent runs** (`max_concurrent_runs`) is how many runs of _this_ job may be active at once. The default for every new job is **1**, the value cannot exceed **1000**, and **0** makes every new run be skipped, which is a way of pausing a job without touching its schedule.

**Queue** (`queue.enabled`) decides the fate of a run that cannot start. Off: the run is discarded and never happens. On: it waits in state `QUEUED` for **up to 48 hours** and starts as soon as capacity appears.

## Why it exists

A job scheduled every five minutes that sometimes takes seven is the whole problem in one sentence. With the defaults, the run that arrives during a slow run is **skipped**, and skipped means gone: no data for that window, no failure, nothing red in the UI to investigate. That is the right default for a job that rewrites the same table, because two overlapping writers are worse than a missed window. It is the wrong default for a job that must process every trigger.

Queueing exists because the other way of losing a run has nothing to do with your job. A workspace has hard ceilings on how much can run at once, so a run can be turned away because two hundred other jobs happened to start at the same moment. Nobody intends that, so queueing buys 48 hours of patience instead.

## How it works

### Maximum concurrent runs

Set it under **Advanced settings** with **Edit concurrent runs**, or as `max_concurrent_runs` in the job definition. It affects only new runs: with concurrency 4 and four runs active, lowering it to 3 kills nothing, but from then on new runs are skipped until fewer than 3 are active. Raise it above 1 when consecutive runs may safely overlap, or when you trigger the same job several times with different parameters (see [[jobs-parameters]]).

A run rejected for this reason ends with `result_state = MAXIMUM_CONCURRENT_RUNS_REACHED`. A continuous job is a special case: there can be only one running instance of it, whatever else you configure.

### Queueing

Queueing is **on by default for jobs created through the UI after 15 April 2024**, and in the Jobs API `queue.enabled` defaults to `true`. Older jobs, and jobs created through paths that do not set it, may still have it off. Toggle it under **Advanced settings** with the **Queue** switch.

It is a **job-level** property: enabling it on one job queues only that job's runs. It does not give that job priority over anything else.

A run is queued when one of exactly three limits is reached. The API reports which one in `status.queue_details.code`:

| Limit reached                                           | `queue_details.code`                 | The ceiling                                                                                                      |
| ------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Maximum concurrent active runs in the workspace         | `ACTIVE_RUNS_LIMIT_REACHED`          | **2,000** tasks running simultaneously per workspace. `Run job` and `For each` parent tasks are not counted here |
| Maximum concurrent `Run Job` task runs in the workspace | `ACTIVE_RUN_JOB_TASKS_LIMIT_REACHED` | **750** parent tasks running simultaneously per workspace. Only `Run job` and `For each` tasks count             |
| Maximum concurrent runs of the job                      | `MAX_CONCURRENT_RUNS_REACHED`        | this job's own `max_concurrent_runs`                                                                             |

All three workspace numbers are fixed limits: you cannot raise them with a support request.

Queued runs appear in the job's run list and in the recent runs list with a **Queued** state, mixed in with runs that actually ran, which is the detail that catches people reading a dashboard. In the API the `life_cycle_state` is `QUEUED`, `queue_duration` is the wait in milliseconds, and `queue_reason` is a string such as `Queued due to reaching maximum concurrent runs of 1.`

### How the two settings combine

| `max_concurrent_runs` | Queue | A trigger fires while the job is busy                                          |
| --------------------- | ----- | ------------------------------------------------------------------------------ |
| 1                     | off   | the run is **skipped**, `MAXIMUM_CONCURRENT_RUNS_REACHED`                      |
| 1                     | on    | the run is **queued** up to 48 hours, then starts when the active run finishes |
| 3                     | off   | runs 2 and 3 start immediately, run 4 is skipped                               |
| 3                     | on    | runs 2 and 3 start immediately, run 4 is queued                                |

### The rest of the ceiling

Concurrency is not the only workspace limit you can walk into, and all of these are fixed:

| Metric                                                      | Limit    | Scope     |
| ----------------------------------------------------------- | -------- | --------- |
| Tasks running simultaneously                                | 2,000    | workspace |
| Parent tasks running simultaneously (`Run job`, `For each`) | 750      | workspace |
| Saved jobs                                                  | 12,000   | workspace |
| Jobs created per hour                                       | 10,000   | workspace |
| `for_each_task.concurrency`                                 | 1 to 100 | task      |

A `For each` task at concurrency 100 consumes up to 100 of the 2,000 task slots and one of the 750 parent slots (see [[jobs-control-flow]]). Ten such jobs at once is half the workspace.

## Example: a five-minute job that must not miss a window

```yaml
resources:
  jobs:
    ingest_orders:
      name: ingest_orders
      max_concurrent_runs: 1 # never two writers on the same table
      queue:
        enabled: true # a late run waits instead of disappearing
      trigger:
        periodic:
          interval: 5
          unit: MINUTES
      tasks:
        - task_key: ingest
          notebook_task:
            notebook_path: ./src/ingest_orders.py
```

One writer at a time, and nothing lost. The opposite shape is a backfill triggered repeatedly through `run-now` with a different `region` parameter each time (see [[jobs-parameters]]): there `max_concurrent_runs: 10` is correct, because the ten runs touch ten disjoint slices of data.

To tell whether runs are being lost or merely waiting, do not scroll the run list. `system.lakeflow.job_run_timeline` carries both `queue_duration_seconds` and `termination_code`:

```sql
SELECT date(period_start_time) AS day,
       count_if(result_state = 'SUCCEEDED') AS succeeded,
       count_if(termination_code = 'MAX_CONCURRENT_RUNS_EXCEEDED') AS lost_to_job_limit,
       count_if(termination_code = 'WORKSPACE_RUN_LIMIT_EXCEEDED') AS lost_to_workspace_limit,
       count_if(termination_code = 'MAX_JOB_QUEUE_SIZE_EXCEEDED') AS lost_to_full_queue,
       MAX(queue_duration_seconds) AS worst_wait_seconds
FROM system.lakeflow.job_run_timeline
WHERE job_id = '<job-id>'
  AND period_start_time > current_date() - INTERVAL 14 DAYS
GROUP BY ALL
ORDER BY day DESC;
```

A `lost_to_job_limit` count every night at the same hour means a schedule tighter than the job's duration. A rising `worst_wait_seconds` means the job still runs, but late, and the 48-hour ceiling is nearer than you think (see [[runs-monitoring]] and [[system-tables]]).

## Common mistakes

- **Reading a skipped run as a success.** It is not a failure, so most notification settings say nothing about it. Turn on queueing, or alert on the skip count.
- **Raising `max_concurrent_runs` to stop losing runs.** That stops the skips and starts the corruption: two runs of the same job writing the same table, interleaved. Queueing is the fix for a serial job; higher concurrency is only correct when the runs touch different data.
- **Believing queueing cannot help with a job's own concurrency limit.** It can: `MAX_CONCURRENT_RUNS_REACHED` is one of the three documented queue reasons. With `max_concurrent_runs: 1` and queueing on, the overlapping run waits; with queueing off, it is skipped.
- **Expecting a queued run to wait forever.** The window is 48 hours. A run queued behind a wedged workspace over a long weekend is lost anyway.
- **Assuming every existing job has queueing on.** The default covers jobs created in the UI after 15 April 2024. Older jobs, and bundles or API calls that set `queue.enabled: false`, do not.
- **Setting `max_concurrent_runs: 0` and forgetting.** A legitimate pause switch that looks exactly like a working job whose runs all vanish.

> [!exam]
> This is a numbers question. The default `max_concurrent_runs` is **1**, the maximum is **1000**, and **0** skips every new run. Without queueing an over-limit run is **skipped**, not failed, and reports `MAXIMUM_CONCURRENT_RUNS_REACHED`. Queueing is on by default for jobs created in the UI after **15 April 2024**, holds a run for up to **48 hours**, and triggers on exactly three limits: the workspace limit on concurrent active runs, the workspace limit on concurrent `Run Job` task runs, and the job's own maximum concurrent runs. The workspace ceiling on concurrent task runs is **2,000**, with a separate **750** for `Run job` and `For each` parent tasks.
