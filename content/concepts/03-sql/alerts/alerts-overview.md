---
id: alerts-overview
title: SQL alerts
area: alerts
level: beginner
summary: A SQL alert re-runs a query on a schedule and notifies a destination when a condition on the result is met.
prerequisites: [jobs-overview, jobs-control-flow]
related: [sql-editor-basics, dashboards-overview, jobs-task-dependencies, jobs-repair-runs]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/sql/user/alerts/
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/sql/user/alerts/create
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/jobs/tasks/alert
    checked: 2026-09-10
aliases: [sql alert, databricks sql alert, alert task, notification]
updated: 2026-09-10
status: published
---

## What it is

A **SQL alert** runs a saved query on a schedule and checks a condition against its result; when the condition is met, it notifies whoever is subscribed. It's the push counterpart to a dashboard: instead of someone opening a chart to check whether something is wrong, the alert tells them.

## Why it exists

Nobody wants to babysit a dashboard waiting for a number to cross a threshold. An alert turns "check this query occasionally" into "run this query on a schedule and only bother me when it matters," and — as a task inside a job — lets a pipeline branch on a data-quality check without a person in the loop.

## How it works

### The condition

An alert is built on top of one query, which must return a single evaluable value: the condition picks a **column** (or an aggregation like SUM or AVERAGE of it), an **operator** (`>`, `<`, `=`, and similar), and a **threshold**. Alerts do not support parameterized queries — the underlying query has to be self-contained. A **Test condition** action lets you check whether the current result would already trigger it.

### Evaluation schedule

The alert's query re-runs on a schedule configured like a job trigger — a simple interval (e.g. every 5 minutes) or, for finer control, a Quartz cron expression.

### Notification destinations

Notifications go to users or to **notification destinations** — email, Slack, webhook, Microsoft Teams, or PagerDuty. Destinations are configured once by a workspace admin and then available to anyone building an alert; subscribers are chosen per alert from that shared list.

### States and re-notification

Each evaluation resolves to one of three states — `OK`, `TRIGGERED`, or `ERROR`. Advanced settings control whether the alert also notifies when it returns to `OK`, how an empty result is treated, and let the notification's subject and body be customized with template variables.

### The alert task in a job

An alert can be a **task** in a Lakeflow job, run right after the task that produces the data it checks. Its status in the job only reflects whether the *evaluation ran successfully* — a warehouse issue or a query error fails the task; the condition actually triggering does **not** fail the job. Branching on whether the alert fired requires a separate conditional task reading the alert's outcome, not just relying on the task's pass/fail.

## Example

An alert query returning one row with one numeric column to evaluate:

```sql
SELECT COUNT(*) AS failed_rows
FROM bronze.landing.orders_rescued
WHERE _rescued_data IS NOT NULL
  AND ingestion_date = CURRENT_DATE();
```

The alert as a task inside a job, right after the load step it checks:

```yaml
tasks:
  - task_key: load_orders
    # ... ingestion task, e.g. Auto Loader or a pipeline

  - task_key: check_rescued_rows
    depends_on:
      - task_key: load_orders
    sql_task:
      alert:
        alert_id: ${var.rescued_rows_alert_id}
        subscriptions:
          - user_name: data-eng@example.com
```

## Common mistakes

- Assuming the job **fails** when the alert condition triggers — the task only reports whether the evaluation itself ran, not the alert's state.
- Alerting on a query that reads from a table that hasn't refreshed yet, effectively checking stale data on every run.
- Setting a threshold so tight that the alert fires constantly, training people to ignore it.
- Forgetting alerts can't use parameterized queries, and hand-duplicating a query just to hardcode a value.
- Subscribing only a person, so the alert goes silent the moment they're on leave, instead of using a shared destination like Slack or email.

> [!tip]
> Treat a noisy alert as a signal about the threshold, not the metric — an alert nobody trusts because it cries wolf is worse than no alert at all.
