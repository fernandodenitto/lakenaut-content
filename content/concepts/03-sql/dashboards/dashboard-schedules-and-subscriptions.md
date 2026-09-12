---
id: dashboard-schedules-and-subscriptions
title: Dashboard schedules and subscriptions
area: dashboards
level: intermediate
summary: "A schedule reruns a published dashboard's dataset queries on a cadence and warms the query result cache; subscriptions deliver the resulting snapshot to email, Slack or Teams."
prerequisites: [dashboards-overview]
related: [sql-warehouse-sizing, alerts-overview, jobs-overview, dashboard-filters-and-variables]
exams:
  - cert: data-analyst-associate
    domain: "Working with Dashboards and Visualizations in Databricks"
    objective: "Schedule an automatic dashboard refresh."
sources:
  - url: https://docs.databricks.com/aws/en/dashboards/share/schedule-subscribe
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/dashboards/limits
    checked: 2026-09-12
  - url: https://docs.databricks.com/api/workspace/lakeview/createschedule
    checked: 2026-09-12
  - url: https://docs.databricks.com/api/workspace/lakeview/createsubscription
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/ai-bi/release-notes/2026
    checked: 2026-09-12
aliases: [dashboard schedule, dashboard subscription, scheduled update, dashboard refresh, query result cache, notification destination, refresh-only schedule, pdf snapshot]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

A **schedule** on a published [[dashboards-overview|AI/BI dashboard]] reruns every dataset query on a cadence you set. A **subscription** attaches recipients to that schedule, so each run also delivers a snapshot of the dashboard to email, a Slack channel or a Microsoft Teams channel.

They are two ideas hung on the same object, and the useful half is often the one people ignore. A schedule with no subscribers still earns its keep: each run populates the **query result cache**, so the next person to open the dashboard reads the cache instead of waiting for the warehouse. Subscriptions are the delivery half, for people who want the numbers without opening a browser.

## Why it exists

Without a schedule a dashboard is cold. The first viewer each morning pays for the full set of dataset queries, and so does everyone whose session misses the cache. On a dashboard that ten people open before a stand-up, the same aggregation over the same gold table can run ten times. A schedule inverts that: the queries run once, at an hour when nobody is waiting, and the humans read a warm cache. Fewer executions of the same SQL also means less load on the warehouse, which is a cost argument as much as a latency one (see [[sql-warehouse-sizing]]).

The older answer to distribution was a person exporting a PDF on a Monday morning and attaching it to an email. Subscriptions make that the platform's job, with the snapshot generated from the same run that warmed the cache, so the attachment and the live dashboard agree.

## How it works

### The cache depends on how you published

The credentials decision made at publish time (see [[dashboards-overview]]) decides what a scheduled run can warm. The documentation now calls the two modes **shared data permissions** and **individual data permissions**.

| Publish mode | What a scheduled run warms |
| --- | --- |
| Shared data permissions | one shared query result cache that every viewer reads, so one run speeds up everybody |
| Individual data permissions | one cache per identity, so each viewer takes a **refresh-only** schedule to warm their own |

Refresh-only is the mode worth knowing by name. A viewer can join a schedule purely to trigger a cache refresh and receive no mail at all. In the UI the per-user choice is **Inactive for me**, **Refresh data for me**, or **Refresh data for me & email**.

### Configuring the schedule

**Schedule** in the top right opens the dialog. You pick a frequency, a start time and a time zone, or tick **Show cron syntax** and write a Quartz cron expression directly. Under **Advanced settings** there are five things that matter:

- **Name**, so a dashboard with several schedules is readable later.
- **SQL warehouse**. By default a scheduled run uses the same warehouse that was used to build and run the dashboard. Pointing scheduled runs at a separate warehouse is usually the right move: overnight refreshes then stop queueing behind interactive traffic.
- **Use current filter selections**, covered below.
- **Custom email subject**.
- **Attachments**: **Include pages** picks which pages go into the PDF, in the order you choose, and **Include data** picks which widgets are exported as CSV, TSV or Excel.

A start time anchors the cadence rather than just the first run. A schedule set to every four hours starting at 15:10 fires at 15:10, 19:10, 23:10 and onward until 15:09 the next day, then resets to 15:10. From the kebab menu a schedule can be edited, paused, resumed, deleted, or fired immediately with **Run now**, which does not disturb the regular cadence. The schedule list also shows recent run indicators: hover one for the run ID, start and end time, and whether it succeeded, failed, or was skipped because the schedule had already hit its concurrent-run limit.

### Filters at run time

By default a scheduled run uses each filter's configured default value. Tick **Use current filter selections** and the selections active when you save the schedule are frozen into it, so the run produces the slice you were looking at rather than the dashboard's defaults. This is the setting behind most confusing snapshots: a PDF that shows last quarter because a filter default says so, or one that is stuck on a region somebody picked six months ago. Decide it deliberately, and see [[dashboard-filters-and-variables]] for how defaults are set in the first place.

### Subscription destinations

| Destination | What lands | Setup |
| --- | --- | --- |
| Email | a PDF snapshot, plus optional widget data as CSV, TSV or Excel | workspace users directly; account users, distribution lists and external recipients as email notification destinations |
| Slack | a PNG snapshot visible in the channel, a link back to the dashboard, and the PDF in the message thread | a workspace admin configures the Slack notification destination first |
| Microsoft Teams | the same PNG, link and threaded PDF | a workspace admin configures the Teams notification destination first |

Data attachments work for any widget with query results behind it, tables and pivot tables included, and you can optionally attach the applied filters as their own file so a recipient can see what shaped the numbers. Data attachments for Slack and Teams arrived in September 2026; before that they were email-only.

### Limits and permissions

| Limit | Value |
| --- | --- |
| Schedules per dashboard | 10 |
| Subscribers per subscription list | 100 (a notification destination counts as one, whatever it fans out to) |
| Combined email attachment size | 9 MB across PDF, PNG and data files |
| Rows per Excel attachment | 100,000 |

Over 9 MB the email degrades rather than failing: if the PDF alone exceeds the limit the mail arrives with no PDF and no images and a note giving the actual size; if the combination exceeds it, only the PDF survives; dropped tabular files produce an explicit line saying so.

Adding or removing other subscribers needs `CAN EDIT` on the dashboard. Adding or removing yourself needs only `CAN VIEW`. Above both sits a workspace setting, **Enable dashboard subscriptions**: with it off, editors can still create schedules but no subscriber can be assigned. Account users are only ever added as a notification destination, so they see no **Subscribe** button.

### When a schedule is the wrong tool

A schedule runs on its own clock, which may or may not be after the pipeline that feeds it. When freshness has to follow the data, make the refresh a dashboard task in the job that builds the tables (see [[jobs-overview]]). When the point is "tell me if a number crosses a line" rather than "send me the board", that is an alert (see [[alerts-overview]]).

## Example: an 07:15 refresh on its own warehouse

Creating the schedule through the Lakeview API, so it lives in source control rather than in somebody's browser:

```bash
databricks api post /api/2.0/lakeview/dashboards/$DASHBOARD_ID/schedules --json '{
  "display_name": "Morning refresh",
  "cron_schedule": { "quartz_cron_expression": "0 15 7 * * ?", "timezone_id": "Europe/Rome" },
  "warehouse_id": "'"$REPORTING_WAREHOUSE_ID"'",
  "pause_status": "UNPAUSED"
}'
```

Then two subscribers on that schedule: a Slack channel that gets the snapshot, and an analyst who only wants the cache warm.

```bash
# Slack channel, as a notification destination configured by a workspace admin
databricks api post \
  /api/2.0/lakeview/dashboards/$DASHBOARD_ID/schedules/$SCHEDULE_ID/subscriptions --json '{
  "subscriber": { "destination_subscriber": { "destination_id": "'"$SLACK_DESTINATION_ID"'" } }
}'

# Refresh-only: joins the schedule, receives nothing
databricks api post \
  /api/2.0/lakeview/dashboards/$DASHBOARD_ID/schedules/$SCHEDULE_ID/subscriptions --json '{
  "subscriber": { "user_subscriber": { "user_id": 4291837465012345 } },
  "skip_notify": true
}'
```

`skip_notify` is the API name for refresh-only. Updates to a schedule need the `etag` from the last read, which is how concurrent edits are caught.

## Common mistakes

- **Assuming a schedule speeds the dashboard up for everyone.** With individual data permissions the run only warms one identity's cache. Either publish with shared data permissions or get each viewer onto a refresh-only schedule.
- **Leaving scheduled runs on the interactive warehouse.** The refresh then competes with the people it is meant to help. Point it at a separate warehouse in Advanced settings.
- **Not deciding what "Use current filter selections" should do.** Left unticked the run uses filter defaults, which is fine if the defaults are right and misleading if they are not.
- **Treating the 9 MB cap as a hard failure.** It is a silent downgrade: the PDF or the data files go missing and the mail still arrives, so nobody notices the report is incomplete.
- **Subscribing individuals when a destination would do.** A notification destination counts as one subscriber against the 100 limit and a distribution list can cover a department, but an unsubscribe from that mail's footer removes the whole list, not just the person who clicked.
- **Using a subscription as a pipeline health check.** A snapshot arrives whether or not the upstream job produced anything new. Check run status instead.

> [!exam]
> The October 2025 Data Analyst Associate guide asks you to schedule an automatic dashboard refresh. Know that a schedule reruns the dataset queries and populates the query result cache, that a subscription is a separate layer on top of a schedule, and the three destinations: email delivers a PDF, Slack and Teams deliver a PNG in the channel plus a link and a threaded PDF. The numbers worth remembering are **100 subscribers** per subscription list and `CAN EDIT` to subscribe other people against `CAN VIEW` to subscribe yourself.
