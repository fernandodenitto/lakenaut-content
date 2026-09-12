---
id: pipelines-event-log
title: The pipeline event log
area: jobs-pipelines
subarea: pipelines
level: advanced
summary: "Every pipeline records its own history in a Delta table: updates, flows, expectation counts and lineage. You read it with the event_log() function, or publish it to Unity Catalog and treat it as a table."
prerequisites: [pipelines-overview, pipelines-expectations]
related: [runs-monitoring, system-tables, unity-catalog-lineage, auto-loader, pipelines-sinks]
exams:
  - cert: de-professional
    domain: "Monitoring and Alerting"
    objective: "Use Lakeflow Spark Declarative Pipelines event logs to monitor pipelines."
sources:
  - url: https://docs.databricks.com/aws/en/ldp/monitor-event-logs
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/ldp/monitor-event-log-schema
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/functions/event_log
    checked: 2026-09-12
aliases:
  [
    event log,
    event_log,
    flow_progress,
    flow_definition,
    operation_progress,
    pipeline monitoring,
    dlt event log,
  ]
updated: 2026-09-12
status: published
---

## What it is

The **event log** is a Delta table that every Lakeflow pipeline writes for itself. One row per event, with a `timestamp`, a `level`, an `event_type`, and a `details` column holding a JSON payload whose shape depends on that event type. The graph you stare at after a failure, the row counts, the quality percentages: the UI renders all of it from this table, and querying it directly also gives you the history the UI throws away.

By default the table is **hidden**. It lives in the catalog and schema configured for the pipeline, named `event_log_{pipeline_id}`, where the pipeline id is the system-assigned UUID with dashes replaced by underscores. It appears in `system.information_schema.tables` but not in Catalog Explorer, and the only way to read it is the `event_log()` table-valued function. You can instead **publish** it under a name you choose, which turns it into an ordinary table you can grant on, join and stream from.

## Why it exists

An update produces a lot of small facts: which flows ran, how many rows each emitted, how many records each expectation dropped, how long the update sat waiting for compute. The UI shows the last update well and the update before that badly. Nothing in it answers "has the `valid_amount` failure rate crept up over three weeks" or "which flow made the update go from four minutes to eleven".

The event log is where those numbers live, and because it is a Delta table rather than an API you get SQL, time travel and joins. Joining `origin.pipeline_id` to `usage_metadata.dlt_pipeline_id` in `system.billing.usage` puts cost per pipeline next to rows per pipeline (see [[system-tables]]).

## How it works

### The function

```sql
-- by pipeline id, as the pipeline's run-as user
SELECT * FROM event_log('ec2a0ff4-d2a5-4c8c-bf1d-d9f12f10e749');

-- or by any streaming table or materialized view the pipeline produces
SELECT * FROM event_log(TABLE(main.silver.orders));
```

The signature is `event_log( { TABLE ( table_name ) | pipeline_id } )`, in Databricks SQL and on Databricks Runtime 13.3 LTS and above. It is owner-only: only the owner of the streaming table or materialized view can call it, and a view over the function can be queried only by that owner and cannot be shared. The default hidden table is readable only by the pipeline's run-as user.

### Publishing it to Unity Catalog

In the pipeline's **Advanced settings**, set the `event_log` object. `name` is required; `catalog` and `schema` are optional and default to the pipeline's own.

```json
{
  "name": "orders_pipeline",
  "event_log": {
    "catalog": "main",
    "schema": "ops",
    "name": "orders_pipeline_event_log"
  }
}
```

Two consequences. The event log location doubles as the schema location for any [[auto-loader|Auto Loader]] queries in the pipeline. And Databricks recommends creating a view over the table before you change privileges, because some compute configurations let a user reach schema metadata when the table is shared directly. Every query below assumes that view:

```sql
CREATE OR REPLACE VIEW main.ops.event_log_raw AS
SELECT * FROM main.ops.orders_pipeline_event_log;
```

Under Unity Catalog the view supports streaming reads, so `spark.readStream.table("main.ops.event_log_raw")` turns the log into a source for your own alerting pipeline.

### Columns

`id`, `sequence`, `origin`, `timestamp`, `message`, `level`, `maturity_level`, `error`, `details`, `event_type`. `level` is `INFO`, `WARN`, `ERROR` or `METRICS`, and `METRICS` events are stored only in the table, never shown in the UI. `maturity_level` is `STABLE`, `NULL`, `EVOLVING` or `DEPRECATED`: do not build alerts on fields marked `EVOLVING` or `DEPRECATED`.

`origin` is a JSON object holding the identity of the event: `pipeline_id`, `pipeline_name`, `pipeline_type` (`WORKSPACE` for a normal pipeline, `DBSQL` for a standalone table, `MANAGED_INGESTION` for Lakeflow Connect), `update_id` (the run id), `flow_name`, `flow_id`, `table_name`, `sink_name`, `batch_id`, `cluster_id`. `flow_id` is the one to know: it stays the same while a flow refreshes incrementally and changes when a materialized view fully recomputes or a checkpoint is reset.

### Event types worth querying

| `event_type`                     | What `details` carries                                                                                                                                            | What you get from it                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `create_update`                  | the full resolved configuration of the update                                                                                                                     | the latest `update_id`, and what settings were actually in force |
| `update_progress`                | `state`: `QUEUED`, `CREATED`, `WAITING_FOR_RESOURCES`, `INITIALIZING`, `RESETTING`, `SETTING_UP_TABLES`, `RUNNING`, `STOPPING`, `COMPLETED`, `FAILED`, `CANCELED` | update duration, and how much of it was waiting for compute      |
| `flow_progress`                  | `status`, `metrics`, `data_quality`                                                                                                                               | rows, backlog and expectation counts per flow                    |
| `flow_definition`                | `input_datasets`, `output_dataset`, `output_sink`, `flow_type`, `schema`, `explain_text`, `language`                                                              | lineage: this is the edge list of the dataflow graph             |
| `operation_progress`             | `type` (`AUTO_LOADER_LISTING`, `AUTO_LOADER_BACKFILL`, `CONNECTOR_FETCH`, `CDC_SNAPSHOT`), `status`, `duration_ms`                                                | where time goes inside a flow                                    |
| `planning_information`           | refresh planning for materialized views                                                                                                                           | why an incremental refresh became a full recompute               |
| `sink_definition`                | the declared sinks                                                                                                                                                | see [[pipelines-sinks]]                                          |
| `user_action`                    | who started, stopped or edited the pipeline                                                                                                                       | audit                                                            |
| `cluster_resources`, `autoscale` | utilisation and scaling                                                                                                                                           | classic compute only                                             |

`flow_progress` is the workhorse. `details:flow_progress.status` is one of `QUEUED`, `STARTING`, `RUNNING`, `COMPLETED`, `FAILED`, `SKIPPED`, `STOPPED`, `IDLE`, `EXCLUDED`. `details:flow_progress.metrics` holds `num_output_rows`, `num_upserted_rows`, `num_deleted_rows`, `num_output_bytes`, `backlog_bytes`, `backlog_records`, `backlog_files`, `backlog_seconds`, `executor_time_ms`. `details:flow_progress.data_quality` holds `dropped_records` and an `expectations` array of `{name, dataset, passed_records, failed_records}`: this is where [[pipelines-expectations]] metrics land.

## Example: two queries you will actually run

Expectation failures per day over the last month. `details` is a string, so the `:` operator opens it and `from_json` gives the array a schema.

```sql
SELECT day, r.dataset, r.name AS expectation,
       SUM(r.passed_records) AS passed,
       SUM(r.failed_records) AS failed,
       ROUND(100 * SUM(r.failed_records) /
             NULLIF(SUM(r.passed_records) + SUM(r.failed_records), 0), 2) AS failed_pct
FROM (
  SELECT date(timestamp) AS day,
         explode(from_json(
           details:flow_progress.data_quality.expectations,
           'array<struct<name: string, dataset: string, passed_records: bigint, failed_records: bigint>>'
         )) AS r
  FROM main.ops.event_log_raw
  WHERE event_type = 'flow_progress'
    AND timestamp > current_timestamp() - INTERVAL 30 DAYS
)
GROUP BY day, r.dataset, r.name
ORDER BY day DESC, failed DESC;
```

Which flow made the last update slow. There is one `flow_progress` event per status change, so the first and last timestamps per flow bracket its work.

```sql
WITH latest_update AS (
  SELECT origin.update_id AS id
  FROM main.ops.event_log_raw
  WHERE event_type = 'create_update'
  ORDER BY timestamp DESC LIMIT 1
)
SELECT origin.flow_name AS flow,
       TIMESTAMPDIFF(SECOND, MIN(timestamp), MAX(timestamp)) AS seconds,
       SUM(COALESCE(TRY_CAST(details:flow_progress.metrics.num_output_rows AS BIGINT), 0)) AS rows_out,
       MAX(TRY_CAST(details:flow_progress.metrics.backlog_bytes AS BIGINT)) AS peak_backlog_bytes,
       MAX_BY(details:flow_progress.status, timestamp) AS final_status
FROM main.ops.event_log_raw
INNER JOIN latest_update ON origin.update_id = latest_update.id
WHERE event_type = 'flow_progress'
  AND origin.flow_name IS NOT NULL
  -- the runtime emits this placeholder for events that belong to no flow
  AND origin.flow_name != 'pipelines.flowTimeMetrics.missingFlowName'
GROUP BY origin.flow_name
ORDER BY seconds DESC;
```

A flow with a big `seconds` and a small `rows_out` is usually waiting on its source, not computing: check `operation_progress` for `AUTO_LOADER_LISTING` on the same update before you resize the compute.

## Common mistakes

- **Deleting the event log, or the catalog or schema you published it to.** Later updates can fail. Treat it as part of the pipeline, not as a log you tidy up.
- **Assuming anybody can read it.** The function is owner-only and a view over it cannot be shared. Publishing the log and granting on a view over the published table is how you give a team access.
- **Treating `details` as a struct.** It is a JSON string: you need the `:` operator, and `from_json` with an explicit schema for the arrays.
- **Summing `num_output_rows` without pinning an update.** The metric is per micro-batch, so numbers from several updates silently pile up. Join to one `update_id`, or group by it.
- **Looking for metrics from a `FAIL UPDATE` expectation.** It stops the update before the counts are written; only warn and drop expectations produce numbers.
- **Building alerts on `EVOLVING` fields.** The schema is allowed to change under you. Check `maturity_level` first.

> [!exam]
> The Professional guide asks you to monitor pipelines with the event log. Know that it is a Delta table, hidden by default as `event_log_{pipeline_id}`, read with `event_log(<pipelineId>)` or `event_log(TABLE(<table>))`, and publishable through the `event_log` object in the pipeline settings. Know which event type answers which question: `flow_progress` for data quality and row counts, `flow_definition` for lineage, `operation_progress` for Auto Loader listings and backfills. Expectation counts sit in `details:flow_progress.data_quality.expectations` as `passed_records` and `failed_records`.
