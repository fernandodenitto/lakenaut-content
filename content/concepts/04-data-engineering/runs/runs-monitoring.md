---
id: runs-monitoring
title: "Monitoring runs: states, run history, trends"
area: runs
level: beginner
summary: The Runs page and a job's run history show states, durations, and the task graph. Comparing a run against the historical baseline is the first step in telling whether a job is getting worse.
prerequisites: [jobs-overview, jobs-task-dependencies]
related: [jobs-task-dependencies, jobs-repair-runs, spark-ui-bottlenecks, cluster-troubleshooting, pipelines-overview]
exams:
  - cert: de-associate
    domain: "Troubleshooting, Monitoring, and Optimization"
    objective: "Identify trends in job performance using the Lakeflow Jobs run history view to compare current execution times against historical baselines."
  - cert: de-associate
    domain: "Troubleshooting, Monitoring, and Optimization"
    objective: "Use the Lakeflow Jobs UI to monitor pipeline health by interpreting job statuses, viewing DAG-based task graphs to spot upstream blockers, and tracking pipeline run times and failure rates"
sources:
  - url: https://docs.databricks.com/aws/en/jobs/monitor
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/jobs/monitor-job-runs
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/admin/system-tables/jobs
    checked: 2026-09-09
aliases: [run history, job runs, matrix view, job monitoring, lakeflow system tables]
updated: 2026-09-09
status: published
---

## What it is

Every execution of a job (see [[jobs-overview]]) or a pipeline (see [[pipelines-overview]]) is a **run**, with a state, a duration, and an outcome for each task. The **Jobs & Pipelines** section of the panel has a **Runs** tab listing recent runs across the whole workspace, and every job has its own **run history** with a matrix and a duration chart. That history, kept for 60 days, is the baseline you compare today's run against.

## Why it exists

You notice a job that fails; you don't notice a job that takes twice as long as it did a month ago, until it blows through the overnight window. Run history makes the **trend** visible: growing durations, failures repeating in the same task, runs stuck in the queue. The run graph, instead, tells you **where** an execution got stuck, without opening the logs.

## How it works

### Run and task states

| State | Meaning |
| --- | --- |
| Queued | waiting because the workspace's concurrent-run or slot limit has been reached |
| Pending | compute starting up |
| Running | in progress |
| Succeeded | every leaf task succeeded |
| Succeeded with failures | the run reached the end but at least one task failed (typical with a `run_if` other than *All succeeded*) |
| Failed | at least one task failed with no recovery |
| Timed Out | the job's or task's timeout was exceeded |
| Canceled, Canceling | stopped by a user or an automation |
| Skipped | never started, for example because a concurrent run was already active |

Individual tasks also have **Upstream failed** and **Upstream canceled**: the task didn't run because an upstream task didn't succeed (see [[jobs-task-dependencies]]). An entire run can also come back **Skipped** because of the job's concurrent-run limit.

### The workspace's Runs tab

Lists active and completed runs of jobs and pipelines you can access, with filters by name, type (job or pipeline), pipeline type, *run as* user, id, start-time range, **state**, and **error code**. Filtering by *Failed* state over the last 48 hours gives you the full picture of last night's problems.

### A job's run history

In a single job's *Runs* tab you'll find:

- **Matrix**: rows = tasks, columns = runs, cells colored by outcome (green success, red failed, pink skipped, yellow waiting on retry, gray pending/canceled/timed out). The *Run total duration* row shows each run's duration as a bar: a task that turns red every Monday, or bars that keep growing week over week, jump out immediately.
- **Run list**: start time, id, trigger, duration, state; clicking the start time opens the run's detail view.
- **Chart of completed runs** over the last 48 hours, with range selection by dragging the cursor.

### A run's detail view

The detail view has three tabs: **graph** (the DAG with tasks colored by state), **timeline** (when each task started and finished, useful for spotting the longest task and overlaps), and **list** (state, type, duration, dependencies). Clicking a task opens its output: the notebook's result, driver logs, a link to the Spark UI (see [[spark-ui-bottlenecks]]), and, for tasks on classic compute, a link to the cluster and its event log (see [[cluster-troubleshooting]]).

To find an upstream blocker: look in the graph for the first **red** task; every gray downstream task marked *Upstream failed* is a consequence, not a cause. After the fix, you restart from there with a repair run (see [[jobs-repair-runs]]).

### Analysis with system tables

The `system.lakeflow.jobs`, `job_tasks`, `job_run_timeline`, and `job_task_run_timeline` tables hold the run history for the whole account and enable analysis the UI doesn't offer: baselines by day of the week, failure rate by job, joins against costs in `system.billing.usage`.

### Notifications

At the job or task level you can send notifications (email, Slack, webhook, PagerDuty via *notification destinations*) on start, success, failure, and **duration warning**: an alert when a run exceeds an expected duration threshold, even if it later finishes fine. It's the easiest way to catch a trend before it turns into a timeout.

## Example

Median and maximum duration per job over the last 30 days, to compare against the latest run:

```sql
SELECT
  j.name,
  COUNT(*)                                         AS runs,
  ROUND(percentile(t.duration_min, 0.5), 1)        AS median_min,
  ROUND(MAX(t.duration_min), 1)                    AS max_min,
  ROUND(100.0 * AVG(t.result_state = 'FAILED'), 1) AS failure_rate_pct
FROM (
  SELECT job_id, workspace_id, result_state,
         timestampdiff(SECOND, period_start_time, period_end_time) / 60 AS duration_min
  FROM system.lakeflow.job_run_timeline
  WHERE period_start_time >= current_date() - INTERVAL 30 DAYS
    AND result_state IS NOT NULL
) t
JOIN system.lakeflow.jobs j
  ON j.job_id = t.job_id AND j.workspace_id = t.workspace_id
GROUP BY j.name
ORDER BY failure_rate_pct DESC, max_min DESC;
```

The same comparison with the SDK, for a specific job:

```python
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
runs = list(w.jobs.list_runs(job_id=123456, completed_only=True, limit=25))
durations = sorted(r.run_duration / 60000 for r in runs if r.run_duration)
print("median minutes:", durations[len(durations) // 2], "latest:", runs[0].run_duration / 60000)
```

## Common mistakes

- Jumping straight into the logs of the first red task you see in the list: in the graph it might be an *Upstream failed*; the real cause is further upstream.
- Reading only the state: a job that's *Succeeded* but takes three times as long as usual is just as much a problem as a failure, and you can only spot it from the duration bar or a duration warning.
- Confusing **Queued** with slow: the run hasn't started yet; the constraint is concurrency or workspace capacity, not the code.
- Relying on the UI's 60 days for long-term analysis: quarterly trends need the system tables.

> [!exam]
> The questions test reading the UI: "the job finished *Succeeded with failures*, what does that mean?" (a task failed but the run reached the end), "how do you tell which task blocked the job?" (the run graph, the first failed task; the ones after it are upstream failed), "how do you compare today's duration against the past?" (the job's run history, duration bars in the matrix; the `system.lakeflow.job_run_timeline` system table for SQL analysis). Remember the **60-day** retention and **duration warning** notifications.
