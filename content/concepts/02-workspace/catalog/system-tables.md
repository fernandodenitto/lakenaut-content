---
id: system-tables
title: System tables
area: catalog
level: intermediate
summary: The system catalog holds read-only tables that record cost, job runs, audit events, lineage, compute and query history for every workspace in a cloud region.
prerequisites: [unity-catalog-overview, privileges-grant-revoke]
related: [runs-monitoring, query-profile, sql-warehouse-sizing, managed-vs-external-tables, jobs-overview]
exams:
  - cert: de-associate
    domain: "Troubleshooting, Monitoring, and Optimization"
    objective: "Read performance trends from job run history to monitor and optimise workloads."
sources:
  - url: https://docs.databricks.com/aws/en/admin/system-tables/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/admin/system-tables/billing
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/admin/system-tables/pricing
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/admin/system-tables/jobs
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/admin/system-tables/audit-logs
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/admin/system-tables/lineage
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/admin/system-tables/compute
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/admin/system-tables/query-history
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/admin/system-tables/warehouse-events
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/dev-tools/cli/reference/system-schemas-commands
    checked: 2026-09-11
aliases: [system catalog, billing.usage, access.audit, lakeflow.jobs, query.history, chargeback]
updated: 2026-09-11
status: published
maturity: ga
---

## What it is

**System tables** are read-only, Databricks-hosted tables in a catalog called `system` that record how your account is actually used: what it costs, which jobs ran and how they ended, who read which table, which clusters existed, which statements executed. You query them with ordinary SQL from any Unity Catalog-enabled compute, and Unity Catalog governs them like any other table.

They are **regional**. One metastore's system tables contain operational data for every workspace in your account deployed in the same cloud region, including workspaces that never moved to Unity Catalog. They are free: you pay only for the compute that runs the query.

## Why it exists

Every one of these facts used to arrive through a different pipe. Audit events came from a log delivery configuration that wrote JSON to a bucket you then had to parse. Cost came from the account console or the billable usage download. Job history came from the Jobs API, one paginated request at a time. Lineage existed only as a picture in the UI. Answering "which team spent the most last quarter, and on which jobs" meant building three ingestion jobs before you could write a line of analysis.

System tables replace that with tables already joined to each other by `workspace_id`, `job_id`, `run_id`, `cluster_id` and `warehouse_id`. The reporting layer platform teams used to build by hand is now part of the product.

## How it works

### Getting access

Users holding both the account admin and metastore admin roles can read system tables by default. For everyone else an admin grants three things:

```sql
GRANT USE CATALOG ON CATALOG system TO `platform-team`;
GRANT USE SCHEMA  ON SCHEMA system.billing TO `platform-team`;
GRANT SELECT      ON SCHEMA system.billing TO `platform-team`;
```

Grants are per schema, which is the point: you can give the finance group `system.billing` without giving them `system.access`, where the audit trail lives. The normal [[privileges-grant-revoke|privilege model]] applies, so `SELECT` on the schema covers every table in it, present and future.

Schemas are listed and turned on per metastore with the CLI (see [[cli-and-sdk]]), by an account admin or a metastore admin:

```bash
databricks system-schemas list <metastore-id>
databricks system-schemas enable <metastore-id> lakeflow
```

Tables that appear in the catalog but stay empty are usually in Private Preview and not yet populated for your account.

### Maturity varies table by table

This is the part people get wrong. "System tables are GA" is not a statement you can make about the whole catalog. The status is per table:

| Table | Status | Free retention |
| --- | --- | --- |
| `billing.usage` | GA | 365 days |
| `billing.list_prices` | GA | indefinite |
| `lakeflow.jobs`, `job_tasks`, `job_run_timeline`, `job_task_run_timeline` | GA | 365 days |
| `access.table_lineage`, `access.column_lineage` | GA | 365 days |
| `compute.clusters`, `node_types`, `warehouses`, `warehouse_events` | GA | 365 days |
| `compute.node_timeline` | GA | 90 days |
| `access.audit` | Public Preview | 365 days |
| `query.history` | Public Preview | 365 days |
| `lakeflow.pipelines`, `lakeflow.pipeline_update_timeline` | Public Preview | 365 days |
| `compute.instance_events`, `compute.instance_pools` | Public Preview | 365 days |
| `tags.governed_tags`, `ai_gateway.external_model_spend` | Beta | varies |

So the two tables most people reach for first, audit and query history, are the two that are still in Public Preview and can change without notice. Billing, jobs, lineage and compute are the GA core you can build a dashboard on.

### billing: usage and list_prices

`system.billing.usage` has one row per unit of consumption, with `usage_date`, `sku_name`, `usage_quantity`, `usage_unit` (typically DBU), `custom_tags`, and two structs that do the real work: `usage_metadata` (which `job_id`, `job_run_id`, `cluster_id`, `warehouse_id`, `dlt_pipeline_id` produced the usage) and `identity_metadata` (`run_as`, `owned_by`). `billing_origin_product` separates JOBS from SQL from MODEL_SERVING. Records are typically available within 12 hours.

Quantities are DBUs, not money. `system.billing.list_prices` turns them into currency: it is a slowly changing table keyed by `sku_name` with `price_start_time`, `price_end_time`, `currency_code` and a `pricing` struct holding `default`, `promotional` and `effective_list`. Every cost query is a join on the SKU plus an interval check on the price validity window.

### lakeflow: jobs and the run timelines

`system.lakeflow.jobs` and `job_tasks` are slowly changing dimensions: one row per version of the definition, stamped with `change_time` and `delete_time`, so a renamed job keeps its history. `job_run_timeline` and `job_task_run_timeline` are immutable fact tables with `period_start_time`, `period_end_time`, `trigger_type`, `run_type`, `result_state`, `termination_code` and the duration breakdown (`queue_duration_seconds`, `setup_duration_seconds`, `execution_duration_seconds`). This is where the trend lives that the UI in [[runs-monitoring]] only shows you one run at a time.

### access: audit and lineage

`system.access.audit` carries `event_time`, `service_name`, `action_name`, `user_identity`, `request_params`, `response`, `source_ip_address` and `audit_level`. Account-level events record `workspace_id` as `0`. Keys containing SQL definitions, such as `view_definition` and `function_info`, are hidden unless you are an account admin or a member of the `databricks_pii_access` group.

`access.table_lineage` and `access.column_lineage` are covered in [[unity-catalog-lineage]]. They are the queryable form of the lineage graph, and they keep a rolling one-year window.

### compute and query

`compute.clusters` is a slowly changing dimension of every cluster configuration, with `dbr_version`, `data_security_mode`, `policy_id` and node types, which makes it the fastest way to audit [[cluster-policies|policy compliance]]. `compute.node_timeline` samples CPU and memory per node per minute, though nodes that ran for less than ten minutes may not appear. `compute.warehouse_events` records `STARTING`, `RUNNING`, `SCALED_UP`, `SCALED_DOWN`, `STOPPING` and `STOPPED` with a `cluster_count`, which is how you size a warehouse from evidence rather than habit.

`system.query.history` holds one row per statement run on a SQL warehouse or on serverless compute for notebooks and jobs, with `statement_text`, `total_duration_ms`, `read_bytes`, `produced_rows` and a `query_source` struct naming what issued it.

## Example: three questions worth asking

The most expensive jobs of last month, in dollars rather than DBUs:

```sql
WITH job_cost AS (
  SELECT
    u.workspace_id,
    u.usage_metadata.job_id                          AS job_id,
    SUM(u.usage_quantity * p.pricing.effective_list) AS usd
  FROM system.billing.usage u
  JOIN system.billing.list_prices p
    ON  u.sku_name = p.sku_name
    AND u.usage_start_time >= p.price_start_time
    AND (p.price_end_time IS NULL OR u.usage_start_time < p.price_end_time)
    AND p.currency_code = 'USD'
  WHERE u.billing_origin_product = 'JOBS'
    AND u.usage_metadata.job_id IS NOT NULL
    AND u.usage_date >= date_trunc('MONTH', add_months(current_date(), -1))
    AND u.usage_date <  date_trunc('MONTH', current_date())
  GROUP BY ALL
)
SELECT c.job_id, j.name, ROUND(c.usd, 2) AS usd
FROM job_cost c
LEFT JOIN (
  SELECT workspace_id, job_id, name,
         ROW_NUMBER() OVER (PARTITION BY workspace_id, job_id ORDER BY change_time DESC) AS rn
  FROM system.lakeflow.jobs
) j
  ON j.workspace_id = c.workspace_id AND j.job_id = c.job_id AND j.rn = 1
ORDER BY usd DESC
LIMIT 20;
```

Tables in `main` that nobody has read in 90 days, the query that finds the storage you are paying for and nobody uses:

```sql
SELECT t.table_catalog, t.table_schema, t.table_name
FROM main.information_schema.tables t
LEFT ANTI JOIN (
  SELECT DISTINCT source_table_full_name
  FROM system.access.table_lineage
  WHERE event_date >= current_date() - INTERVAL 90 DAYS
    AND source_table_full_name IS NOT NULL
) r
  ON r.source_table_full_name = t.table_catalog || '.' || t.table_schema || '.' || t.table_name
WHERE t.table_schema <> 'information_schema'
ORDER BY 1, 2, 3;
```

SQL warehouses that have shown no activity for a month:

```sql
SELECT warehouse_id, MAX(event_time) AS last_event
FROM system.compute.warehouse_events
GROUP BY warehouse_id
HAVING MAX(event_time) < current_timestamp() - INTERVAL 30 DAYS;
```

## Common mistakes

- **Treating `usage_quantity` as cost.** It is DBUs. Without the join to `list_prices` and its validity window you are adding up SKUs that cost very different amounts per DBU.
- **Expecting `usage_metadata.job_id` on every job row.** It is populated for job compute and serverless compute. A job on all-purpose compute shares a cluster with notebooks, and its cost cannot be attributed precisely.
- **Building a production dashboard on `access.audit` or `query.history` without noticing they are in Public Preview.** Both can change without notice. Pin the columns you depend on.
- **Granting `SELECT` on the whole `system` catalog.** The audit schema shows who queried what, and from which IP address. Grant per schema.
- **Forgetting the retention edge.** Most tables keep 365 days free, but `compute.node_timeline` keeps 90. For a longer series, materialise a rollup on a schedule.

> [!exam]
> The Data Engineer Associate guide asks you to read performance trends from job run history, and system tables are where those trends live: `system.lakeflow.job_run_timeline` for `result_state`, `period_start_time` and the duration breakdown, joined to `system.billing.usage` on `workspace_id`, `job_id` and `run_id`. Know that the catalog is called `system`, that reading it needs `USE CATALOG` on `system` plus `USE SCHEMA` and `SELECT` on the schema, and that the data covers every workspace in the region rather than the one you are logged into.
