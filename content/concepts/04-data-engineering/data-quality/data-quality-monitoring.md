---
id: data-quality-monitoring
title: Data profiling and anomaly detection
area: data-quality
level: intermediate
summary: Unity Catalog's own quality monitoring, with two halves that answer different questions, two metric tables you can query, and a schedule that costs serverless compute.
prerequisites: [data-quality-overview, unity-catalog-overview]
related: [data-quality-overview, pipelines-expectations, dqx-framework, system-tables, unity-catalog-lineage]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-quality-monitoring/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-quality-monitoring/data-profiling/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-quality-monitoring/anomaly-detection/
    checked: 2026-09-12
aliases: [lakehouse monitoring, data profiling, profile metrics, drift metrics, anomaly detection, freshness, completeness, monitor]
updated: 2026-09-12
status: published
maturity: ga
maturity_checked: 2026-09-12
---

## What it is

Unity Catalog groups two features under **data quality monitoring**, and they answer opposite questions.

**Data profiling** attaches a monitor to a table you nominate and computes statistics on a schedule. It answers "what does this table look like, and how has that changed". It is the feature that used to be called Lakehouse Monitoring.

**Anomaly detection** works at the schema level and learns from history instead of from rules. It answers "did something stop arriving, or arrive thin, without anybody writing a check for it".

The first is generally available. The second is in Public Preview, with several of its sub-capabilities still in Beta, so read the labels on the page before you promise anything.

Neither one blocks a write. They observe. If the requirement is that bad data must not land, you want a constraint or an expectation, both covered in [[data-quality-overview]].

## Why it exists

Every rule-based quality system shares a blind spot: it can only catch what somebody thought to check. The row count halving is not a rule violation, because every surviving row is valid. An upstream job that silently stopped produces a table that passes every expectation it has, because the rows that would have failed never arrived.

Profiling catches the first case by measuring the shape of the data over time. Anomaly detection catches the second by learning what normal looks like per table and telling you when a table goes quiet.

## How it works

### Choosing the profile type

| Type | Use it for | What it computes |
| --- | --- | --- |
| **Time series** | tables with a timestamp column | metrics per time window across the series |
| **Inference** | model request logs, where a row is a request with inputs and a prediction | model quality and drift alongside data quality |
| **Snapshot** | everything else | metrics over the whole table, each run |

Two limits decide the choice more often than the description does. A snapshot profile tops out at **4 TB**, and above that you use a time series profile instead. Time series and inference profiles compute over the **last 30 days**.

Supported formats are Delta tables and Unity Catalog managed Iceberg tables.

### What you get back

Two Delta tables in Unity Catalog, which is the part that makes this worth more than a screen:

- the **profile metrics table**, with summary statistics for the whole table, for each time window, for each slice you defined, and per model where that applies;
- the **drift metrics table**, comparing each window against the previous one and, if you gave it one, against a baseline.

Because they are tables, an alert on quality is an ordinary SQL alert over a table, and a quality dashboard is an ordinary dashboard. Databricks also generates a customisable dashboard when you create the monitor, which is a reasonable starting point rather than the destination.

### What it costs

Monitors run on serverless compute for jobs, and notably your account does not need to be enabled for serverless in general to use them. The spend shows up in the monitoring cost view.

This is the part to think about before turning it on everywhere. A monitor on every table in a large metastore is a recurring bill for statistics nobody reads. Monitor the tables that other people depend on, which in practice means the gold layer and anything shared outside the team.

### Anomaly detection, briefly

Anomaly detection is enabled per schema rather than per table, and it scans intelligently rather than exhaustively, prioritising tables that are popular or have downstream dependencies. It learns two things from history:

- **freshness**: how recently the table is normally updated, from its commit history;
- **completeness**: how many rows normally arrive in a day, predicted from the past.

It then flags tables that are late or thin, and uses lineage to suggest where the problem started. The results appear as health indicators in Catalog Explorer, which is the most visible surface the feature has.

> [!note]
> Anomaly detection is in Public Preview as of September 2026, and some pieces of it, including percent null for completeness and completeness slicing, are Beta. The health indicators inherit the Public Preview label from the parent page.

## Example: alerting on drift without inventing a framework

```sql
-- The drift table is just a table. This is "the null rate on a column doubled".
SELECT
  window.start AS window_start,
  column_name,
  drift_type,
  percent_null_delta
FROM main.quality.orders_profile_drift_metrics
WHERE column_name = 'customer_id'
  AND percent_null_delta > 0.05
  AND window.start >= current_date() - INTERVAL 14 DAYS
ORDER BY window_start DESC;
```

Point a SQL alert at that query and the quality system is finished. There is no second alerting stack to run, because the output was a table from the start.

## Common mistakes

- **Monitoring everything.** Serverless compute per monitor per schedule adds up. Monitor what other people read.
- **Reading a monitor as enforcement.** It reports after the write. Nothing here stops a bad row landing.
- **Choosing snapshot for a large table.** Above 4 TB it is not an option, and well below that it is a slow way to learn what a time series profile would tell you per window.
- **Ignoring the baseline.** Drift against the previous window tells you something moved. Drift against a baseline you chose tells you whether it moved away from correct.
- **Treating anomaly detection as settled.** It is in Public Preview, and the pieces that people most want, the null-rate and slicing parts, are Beta. Pilot it; do not build a compliance report on it yet.
