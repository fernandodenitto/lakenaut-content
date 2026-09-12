---
id: jobs-repair-runs
title: Repair runs, retries, and notifications
area: jobs-pipelines
subarea: jobs
level: intermediate
summary: A repair reruns only the failed tasks and their downstream tasks within the same run; notifications via email or system destinations, duration-based health rules, and queueing round out error handling.
prerequisites: [jobs-overview, jobs-task-dependencies]
related: [jobs-control-flow, runs-monitoring, jobs-triggers, jobs-parameters]
exams:
  - cert: de-associate
    domain: "Working with Lakeflow Jobs"
    objective: "Implement control flows (retries and conditional tasks such as branching and looping) using Lakeflow Jobs for pipeline orchestration"
  - cert: de-associate
    domain: "Troubleshooting, Monitoring, and Optimization"
    objective: "Use the Lakeflow Jobs UI to monitor pipeline health by interpreting job statuses, viewing DAG-based task graphs to spot upstream blockers, and tracking pipeline run times and failure rates"
sources:
  - url: https://docs.databricks.com/aws/en/jobs/repair-job-failures
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/jobs/notifications
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/jobs/configure-job
    checked: 2026-09-09
  - url: https://docs.databricks.com/api/workspace/jobs/repairrun
    checked: 2026-09-09
aliases: [repair run, repair job run, notifications, health rules, queueing, notification destinations]
updated: 2026-09-12
status: published
---

## What it is

A **repair run** resumes a failed run **from the point where it broke**: the platform reruns the tasks that didn't succeed and everything downstream of them, while keeping the already-completed tasks as-is. The run keeps the same `run_id`; every repair adds a `repair_id` and a column in the matrix view.

Around repair you'll find automatic **retries**, **notifications**, duration-based **health rules**, and run **queueing**.

## Why it exists

A ten-task ETL that fails on the ninth task shouldn't cost another nine tasks' worth of compute to retry. Before repair existed, you relaunched everything. Repair reruns only what's necessary and preserves history: one run, repaired, instead of a sequence of attempts you have to piece back together (see [[runs-monitoring]]).

## How it works

### Automatic retry vs. manual repair

| | Retry (task) | Repair run |
| --- | --- | --- |
| Who starts it | the platform, immediately | a person (UI, API, SDK) |
| When | a transient error, nothing changes | after fixing code, data, or parameters |
| What it reruns | the same task | failed tasks, skipped tasks, and everything downstream |
| Configuration | `max_retries`, `min_retry_interval_millis`, `retry_on_timeout` (see [[jobs-control-flow]]) | `rerun_all_failed_tasks`, `rerun_tasks`, `rerun_dependent_tasks` |
| Counter | `{{task.execution_count}}` | `{{job.repair_count}}` |

Retry covers a network blip; repair covers "I fixed the notebook" or "the right file is here now."

### What a repair reruns

By default the *Repair run* dialog selects the failed tasks, the ones `SKIPPED` because of an unmet dependency, and the tasks downstream of them. You can narrow the selection to a subset (`rerun_tasks` in the API) or choose whether to include the dependents (`rerun_dependent_tasks`). Before confirming you can change the **job parameters**: values entered in the dialog override the run's original ones; to go back to the defaults on a later repair, clear the field (see [[jobs-parameters]]). Job changes made before the repair are applied too.

Constraints: repair is only available for jobs with **at least two tasks**; a repaired task restarts **from scratch**, so if it had already written half its data before failing, the data can end up duplicated — tasks need to be idempotent (MERGE, partition overwrite, `INSERT OVERWRITE`).

### Repair or a new run?

| Choose | When |
| --- | --- |
| Repair | the problem was in the failed task or downstream of it; the successful tasks' data is still valid |
| New run ("Run now") | the source data has changed, or the job has only one task |
| Run now with different parameters | you want a full run with different values, without touching the history of the broken run |

### Notifications

The available events are `on_start`, `on_success`, `on_failure`, `on_duration_warning_threshold_exceeded`, and the streaming backlog threshold. Two kinds of destination:

- **email**, set directly on the job or the task;
- **system destinations** (Slack, Microsoft Teams, PagerDuty, HTTP webhook), created by an admin and reused across jobs, up to three per event.

Notifications are configured at the **job** or **task** level. Important distinction: a job-level notification doesn't fire on every retry, only on the final outcome; for an alert on every attempt you need task-level notifications, or the `alert_on_last_attempt` flag. `notification_settings` lets you silence skipped runs (`no_alert_for_skipped_runs`) and canceled runs (`no_alert_for_canceled_runs`); job-level filters don't propagate to tasks.

### Health rules and timeout

**Health rules** (`health.rules`) compare a metric against a threshold: `RUN_DURATION_SECONDS` with the `GREATER_THAN` operator raises a *duration warning* event once the run exceeds the given number of seconds, without stopping it. The job's **timeout** (`timeout_seconds`), on the other hand, terminates it with a *Timed Out* state. For streaming there are `STREAMING_BACKLOG_*` metrics.

### Queueing

With `queue.enabled` (on by default for jobs created in the UI after April 2024), a run that cannot start gets **queued** for up to 48 hours instead of being lost, and shows in the list with a *Queued* state. Three limits send a run to the queue: the workspace limit on active runs, the workspace limit on `Run job` task runs, and **the job's own `max_concurrent_runs`**. With queueing off, a run that hits the job's limit is skipped instead. See [[jobs-queue-and-concurrency]] for the numbers and the queue reason codes.

## Example

A job with notifications, a health rule, and queueing:

```yaml
resources:
  jobs:
    load_orders:
      name: load_orders
      timeout_seconds: 7200
      max_concurrent_runs: 1
      queue: { enabled: true }
      health:
        rules:
          - metric: RUN_DURATION_SECONDS
            op: GREATER_THAN
            value: 3600
      email_notifications:
        on_failure: [data-team@example.com]
        on_duration_warning_threshold_exceeded: [data-team@example.com]
      webhook_notifications:
        on_failure: [{ id: ${var.slack_destination_id} }]
      notification_settings:
        no_alert_for_skipped_runs: true
        no_alert_for_canceled_runs: true
      tasks:
        - task_key: ingest
          notebook_task: { notebook_path: ./notebooks/ingest.py }
          max_retries: 2
          min_retry_interval_millis: 120000
        - task_key: transform
          depends_on: [{ task_key: ingest }]
          notebook_task: { notebook_path: ./notebooks/transform.py }
        - task_key: publish
          depends_on: [{ task_key: transform }]
          sql_task:
            warehouse_id: ${var.warehouse_id}
            file: { path: ./sql/publish.sql }
```

A repair triggered from code, with a corrected parameter, limited to the failed tasks and their dependents:

```python
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
w.jobs.repair_run(
    run_id=123456,
    rerun_all_failed_tasks=True,
    rerun_dependent_tasks=True,
    job_parameters={"start_date": "2026-09-08"},
)
```

## Common mistakes

- Repairing a task that had already written half its rows with an `INSERT INTO`: duplicates. You need idempotency.
- Expecting a *Repair run* button on a job with a single task: it doesn't exist, use *Run now*.
- Setting only job-level notifications and wondering why intermediate retries don't alert: you need task-level notifications, or `alert_on_last_attempt`.
- Confusing health rules with timeout: the former warns, the latter kills the run.
- Assuming an overlapping run is always skipped. With queueing on it is queued, including when the job's own `max_concurrent_runs` is the limit it hit. Skipping is what happens with queueing off.

> [!exam]
> The exam distinguishes **retry** (automatic, same task, configured on the task) from **repair** (manual, failed tasks and everything downstream, same run, with the option to change parameters). On notifications, it asks about the difference between email and system destinations (Slack, Teams, PagerDuty, webhook), and knows that a job-level notification doesn't fire on retries. On monitoring: the run matrix view shows repair columns, and a health rule on `RUN_DURATION_SECONDS` is how you catch a job that's running too slow without stopping it.
