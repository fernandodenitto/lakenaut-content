---
id: jobs-triggers
title: "Triggers: schedule, file arrival, table update, continuous"
area: jobs-pipelines
subarea: jobs
level: intermediate
summary: A job can start on a schedule (Quartz cron), when files land in a volume or external location, on a Unity Catalog table commit, or run continuously. Time-based vs. data-driven is a favorite exam question.
prerequisites: [jobs-overview]
related: [jobs-control-flow, jobs-repair-runs, jobs-parameters, auto-loader, pipelines-overview]
exams:
  - cert: de-associate
    domain: "Working with Lakeflow Jobs"
    objective: "Implement job schedules using Lakeflow Jobs with an understanding of trigger types (scheduled, file arrival, and table update)"
  - cert: de-associate
    domain: "Working with Lakeflow Jobs"
    objective: "Choose between time-based and data-driven triggers based on data availability and pipeline dependencies."
sources:
  - url: https://docs.databricks.com/aws/en/jobs/triggers
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/jobs/scheduled
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/jobs/file-arrival-triggers
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/jobs/trigger-table-update
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/jobs/continuous
    checked: 2026-09-09
  - url: https://docs.databricks.com/api/workspace/jobs/create
    checked: 2026-09-09
aliases: [schedule, cron, file arrival trigger, table update trigger, continuous job, trigger]
updated: 2026-09-12
status: published
---

## What it is

A **trigger** is the rule that starts a job run without human intervention. Lakeflow Jobs offers four families of triggers, plus the manual trigger ("Run now", see [[jobs-overview]]):

| Trigger | Fires when… | Family |
| --- | --- | --- |
| Scheduled | a cron expression or interval matches | time-based |
| File arrival | new files show up at a Unity Catalog path | data-driven |
| Table update | one or more Unity Catalog tables receive a commit | data-driven |
| Continuous | the previous run finishes: the job just keeps running | always-on |

A job has **exactly one** active trigger; *continuous* and *scheduled* can't be combined.

## Why it exists

Cron answers "every night at 2 AM," not "as soon as the vendor finishes loading." With cron alone you end up scheduling "late enough to be safe," which means processing stale data or running for nothing. Data-driven triggers shift the question from time to data: the job starts when there's actually something to do, and it knows *what* arrived.

## How it works

### Scheduled

The schedule uses **Quartz cron** syntax: six or seven fields (seconds, minutes, hours, day of month, month, day of week, optional year), with `?` in one of the two "day" fields. In the API this is the `schedule` block with `quartz_cron_expression`, `timezone_id`, and `pause_status` (`PAUSED` or `UNPAUSED`). The UI also offers a "simple" schedule (every N minutes/hours/days/weeks), which maps to `trigger.periodic` with `interval` and `unit` in the API.

Practical rules: minimum interval of 10 seconds; a run can start a few minutes late; in a time zone that observes daylight saving, an hourly job can skip or shift around the clock change, so **UTC** is the safer choice. Pausing the schedule doesn't touch the definition.

### File arrival

Watches a Unity Catalog **volume** or **external location** (S3, ADLS, GCS), recursively through subfolders. Fields:

- `url`: the watched path, no wildcards, not on an external table;
- `min_time_between_triggers_seconds`: at most one run within this interval;
- `wait_after_last_change_seconds`: waits for the file flow to settle; every new file resets the countdown.

Both timers have a 60-second minimum. The check runs roughly every minute and only counts **new files**, not overwrites. Without *file events* on the external location, limits apply (50 jobs per workspace, 10,000 files in the path); with file events enabled, those limits go away. You need `READ` on the path and `CAN MANAGE` on the job. Inside the run, `{{job.trigger.file_arrival.location}}` holds the path (see [[jobs-parameters]]); pair it with [[auto-loader]] to actually read the files.

### Table update

Watches up to **10** Unity Catalog tables (managed Delta or Iceberg, external Delta, streaming table, materialized view) and fires on every **commit**: insert, merge, delete. The `condition` field is `ANY_UPDATED` (one table is enough, the default) or `ALL_UPDATED` (every table must have changed since the last run); the `min_time_between_triggers_seconds` and `wait_after_last_change_seconds` timers work the same as for files. You need `SELECT` on the tables. Inside the run you get `{{job.trigger.table_update.updated_tables}}` and, for each table, `version` and `commit_timestamp`.

### Continuous

With `continuous.pause_status: UNPAUSED` the job restarts as soon as it finishes, with **only one run active** at a time. On errors the platform applies **exponential backoff**, not `max_retries`; dependencies between tasks aren't supported. You stop it with *Pause*. It's meant for always-on Structured Streaming notebooks; for pipelines, there's the *continuous* mode described in [[pipelines-overview]].

### Concurrency and queueing

`max_concurrent_runs` defaults to 1, so a trigger that fires while a run is in progress has to do something with the new run. With queueing off it is **skipped**. With queueing on, which is the default for jobs created in the UI after April 2024, it is **queued** instead, because the job's own concurrency limit is one of the three limits that trigger queueing. See [[jobs-queue-and-concurrency]].

### Time-based or data-driven?

| Situation | Recommended trigger |
| --- | --- |
| Daily report at a fixed time, sources are always ready | Scheduled (cron, UTC) |
| A vendor drops files at irregular times | File arrival on the landing volume |
| Silver depends on bronze written by another job | Table update on bronze, `ANY_UPDATED` |
| Gold requires **all** upstream tables to be updated | Table update, `ALL_UPDATED` |
| Kafka source or continuous logs, second-level latency | Continuous (or a continuous pipeline) |
| Job downstream of another job on the same team | no trigger: a Run job task (see [[jobs-control-flow]]) |

## Example

Three jobs with different triggers in a bundle:

```yaml
resources:
  jobs:
    nightly_report:
      name: nightly_report
      schedule:
        quartz_cron_expression: "0 0 2 * * ?"   # every day at 2:00 AM
        timezone_id: UTC
        pause_status: UNPAUSED
      max_concurrent_runs: 1
      tasks:
        - task_key: report
          sql_task:
            warehouse_id: ${var.warehouse_id}
            file: { path: ./sql/report.sql }

    ingest_landing:
      name: ingest_landing
      trigger:
        pause_status: UNPAUSED
        file_arrival:
          url: /Volumes/main/landing/sales/
          min_time_between_triggers_seconds: 300
          wait_after_last_change_seconds: 120
      tasks:
        - task_key: ingest
          notebook_task:
            notebook_path: ./notebooks/ingest.py
            base_parameters: { path: "{{job.trigger.file_arrival.location}}" }

    silver_sales:
      name: silver_sales
      trigger:
        pause_status: UNPAUSED
        table_update:
          table_names: [main.bronze.sales, main.bronze.customers]
          condition: ALL_UPDATED
          wait_after_last_change_seconds: 60
      tasks:
        - task_key: silver
          notebook_task: { notebook_path: ./notebooks/silver.py }
```

A continuous job is declared with `continuous: { pause_status: UNPAUSED }` instead of `schedule` or `trigger`.

## Common mistakes

- Writing a five-field Linux-style cron: Quartz wants six or seven fields and starts with **seconds**.
- Scheduling for 2:00 AM in a time zone with daylight saving and being surprised by a missing run on the night the clocks change.
- Using file arrival to detect a file being **overwritten**: it only fires on new files.
- Forgetting `wait_after_last_change_seconds` for a vendor that uploads 200 files in five minutes: the job starts on the first file.
- Raising `max_concurrent_runs` "so you don't miss a run": two parallel runs hitting the same table step on each other.

> [!exam]
> Typical questions: "the job must start as soon as the partner uploads files" → file arrival; "gold must refresh after both bronze **and** silver have changed" → table update with *All tables updated*; "report every Monday at 6" → Quartz cron. Know that data-driven triggers require Unity Catalog, that the two timers (minimum time between triggers, wait after the last change) apply to both files and tables, and that with `max_concurrent_runs = 1` an overlapping run gets **skipped**.
