---
id: materialized-views-sql
title: Standalone materialized views in Databricks SQL
area: sql-warehouses
level: intermediate
summary: A materialized view created from Databricks SQL gets its own serverless pipeline. How to schedule the refresh, when it is incremental, and why the bill lands on pipelines rather than on your warehouse.
prerequisites: [gold-layer-objects, sql-warehouse-sizing]
related: [serverless-compute, pipelines-overview, delta-lake-overview, dashboards-overview, runs-monitoring]
exams:
  - cert: data-analyst-associate
    domain: "Executing queries using Databricks SQL and Databricks SQL Warehouses"
    objective: "Create a materialized view, including knowing when to use Streaming Tables and Materialized Views, and differentiate between dynamic and materialized views."
sources:
  - url: https://docs.databricks.com/aws/en/ldp/dbsql/materialized
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-ddl-create-materialized-view
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/optimizations/incremental-refresh
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/ldp/dbsql/streaming
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/views/dynamic
    checked: 2026-09-11
aliases: [materialized view, standalone materialized view, MV, REFRESH MATERIALIZED VIEW, TRIGGER ON UPDATE, incremental refresh, row tracking]
updated: 2026-09-11
status: published
maturity: ga
---

## What it is

A **standalone materialized view** is a Unity Catalog managed table that physically stores the result of a query, defined outside a Lakeflow pipeline. You write `CREATE MATERIALIZED VIEW` in the SQL editor, or from a notebook on serverless general compute, and Databricks creates a dedicated **serverless pipeline** behind it to do the create and every later refresh.

"Standalone" only distinguishes it from a materialized view declared inside a pipeline. The object and the refresh machinery are the same; what differs is that you maintain no pipeline file, no job and no schedule. The generated pipeline appears under **Jobs & Pipelines** when you filter the type to **MV/ST**.

Creation is synchronous: `CREATE OR REPLACE MATERIALIZED VIEW` blocks until the initial load finishes, and it needs a Pro or Serverless SQL warehouse.

## Why it exists

A plain view pays for its query on every read, which is fine until a dashboard with twelve widgets refreshes for forty people each morning. The usual fix is to precompute into a Delta table, which means a job, a `MERGE`, a schedule and someone to fix it when an upstream table lands late.

A materialized view is the declarative middle: you state the query once and the platform decides when and how much to recompute, and on what compute. You trade freshness for read cost, and control for maintenance (see [[gold-layer-objects]]).

## How it works

### Refresh modes

A refresh happens in one of four ways, and a scheduled view can still be refreshed by hand.

| Mode | Syntax | Notes |
| --- | --- | --- |
| Manual | `REFRESH MATERIALIZED VIEW mv1 [ASYNC] [FULL]` | the owner, or anyone with `REFRESH` on the view |
| Interval | `SCHEDULE EVERY n HOURS`, `… DAYS`, `… WEEKS` | 1 to 72 hours, 1 to 31 days, 1 to 8 weeks |
| Cron | `SCHEDULE CRON '<quartz>' AT TIME ZONE '<tz>'` | six fields, seconds first, with `?` for whichever day field you leave unset |
| On update | `TRIGGER ON UPDATE [AT MOST EVERY <interval>]` | refreshes when an upstream source changes |

`TRIGGER ON UPDATE` is the right default for production when upstream jobs do not run on a predictable clock. Its limits: at most **10 upstream sources** per materialized view, at most **1000** streaming tables or materialized views using it, and an `AT MOST EVERY` interval of at least one minute (also the default). Sources must be Delta tables, materialized views, streaming tables, or views over those.

A refresh is synchronous unless you add `ASYNC`, which is what you want from a Lakeflow job SQL task where the next step depends on the data being there. `ASYNC` returns immediately, lets the warehouse shut down while the refresh runs elsewhere, and allows several refreshes in parallel.

### Incremental or full

Every refresh is one of two things. An **incremental refresh** finds what changed in the sources since the last update and merges only that. A **full recompute** runs the whole query and replaces the contents. The results are identical; the cost is not.

By default Databricks runs a cost model and picks whichever is cheaper, so a query that *can* refresh incrementally sometimes will not. `REFRESH POLICY` overrides that: `AUTO` (the default), `INCREMENTAL` (prefer incremental, fall back to full), `INCREMENTAL STRICT` (fail rather than fall back) or `FULL`. Reach for `INCREMENTAL STRICT` when an unexpected full recompute would blow a cost or latency budget: a failed update you can debug beats a silent full scan. The clause is marked Beta in the SQL reference.

### Finding out which one you got

Three places answer this:

- **Before you create it**, `EXPLAIN CREATE MATERIALIZED VIEW … AS <query>` says whether the query is structurally incrementalisable. It does not promise that `AUTO` will choose incremental.
- **In the UI**, the pipeline's Tables panel has an **Incrementalization** column per update: `Incremental`, `Full recompute` or `No change`, with an insight attached when something preventable blocked it.
- **In SQL**, query the pipeline event log for `planning_information` events. The message names the technique: `FULL_RECOMPUTE`, `NO_OP`, or one of `ROW_BASED`, `APPEND_ONLY`, `GROUP_AGGREGATE`, `GENERIC_AGGREGATE`, `PARTITION_OVERWRITE` and `WINDOW_FUNCTION`.

### What incremental refresh needs from the sources

Incremental refresh only runs on serverless, and it needs **row tracking** on the Delta sources for most operations. Databricks also recommends deletion vectors and change data feed on every source table:

```sql
ALTER TABLE sales.silver.orders SET TBLPROPERTIES (
  delta.enableRowTracking = true,
  delta.enableDeletionVectors = true,
  delta.enableChangeDataFeed = true);
```

Recreating a source table drops the property, so re-enable it. Two other traps: a source carrying a **row filter or column mask** never refreshes incrementally, by design, and `SUM` or `AVG` over a `FLOAT` or `DOUBLE` column forces a full recompute, which you fix by casting to `DECIMAL` inside the expression.

Supported sources are Delta tables, materialized views, streaming tables and Unity Catalog managed Iceberg tables. Volumes, external locations, foreign catalogs and foreign Iceberg tables are not.

### The billing fact

`CREATE MATERIALIZED VIEW` and `REFRESH MATERIALIZED VIEW` do not run on your SQL warehouse. They run on the generated serverless pipeline and are **billed as serverless Lakeflow pipelines DBUs**, with the warehouse only coordinating.

So the size of your warehouse neither caps nor speeds up a refresh, cost scales with the volume of data processed, and serverless charges can appear even when the warehouse uses dedicated compute. To attribute the spend, use the system tables rather than warehouse monitoring.

### Against a streaming table and against a view

A **streaming table** processes each input row exactly once and appends. Use it where a full recompute would be unacceptable or impossible: very large tables, ingestion with [[auto-loader|Auto Loader]], Kafka and other sources with no history, or any source you prune after processing. A materialized view guarantees batch semantics instead, which is why a change to a dimension is reflected everywhere and why it must be able to fall back to a full recompute.

A plain **view** stores no data and recomputes on every read. A **dynamic view** is a plain view that calls `current_user()` or `is_account_group_member()` to filter rows or mask columns per viewer, so it is an access-control tool rather than a performance one.

Materialized views support no time travel, identity columns, surrogate keys, `CLONE`, or manual `OPTIMIZE` and `VACUUM`. Maintenance is automatic.

## Example: a daily revenue rollup

```sql
-- Incremental refresh needs row tracking on the source.
ALTER TABLE sales.silver.orders SET TBLPROPERTIES (
  delta.enableRowTracking = true,
  delta.enableChangeDataFeed = true);

CREATE OR REPLACE MATERIALIZED VIEW sales.gold.daily_revenue_by_region
  COMMENT 'Revenue and order count per day and region'
  SCHEDULE CRON '0 30 3 * * ?' AT TIME ZONE 'UTC'
  REFRESH POLICY INCREMENTAL
AS SELECT
  date_trunc('day', order_time) AS sales_date,
  region,
  sum(cast(revenue AS DECIMAL(18,2))) AS total_revenue,  -- DECIMAL, not DOUBLE
  count(*) AS order_count
FROM sales.silver.orders
GROUP BY sales_date, region;
```

Swap the schedule for `TRIGGER ON UPDATE AT MOST EVERY INTERVAL 15 MINUTES` when the upstream job runs at an unpredictable time.

Check what happened on the last few updates:

```sql
SELECT timestamp, message
FROM event_log(TABLE(sales.gold.daily_revenue_by_region))
WHERE event_type = 'planning_information'
ORDER BY timestamp DESC
LIMIT 5;
```

## Common mistakes

- **Scaling the warehouse up to make a refresh faster.** The refresh does not run there. You have only made the coordination more expensive.
- **Forgetting row tracking on the sources.** Every refresh silently becomes a full recompute, and recreating a source table turns the property off again.
- **Leaving an aggregate on a `DOUBLE` column.** `SUM` over floating point forces a full recompute. Cast to `DECIMAL` inside the expression.
- **Writing `SELECT col1, SUM(col2) FROM t GROUP BY col1`.** Non-column expressions need an alias, or the `CREATE` is rejected.
- **Using a materialized view for ingestion.** Records that must be processed once, or sources with no history such as Kafka, need a streaming table.
- **Expecting time travel, `OPTIMIZE` or `CLONE`.** None apply. If you need them, the object should be a Delta table maintained by a job.

> [!exam]
> The guide asks you to create a materialized view and to tell three objects apart. A materialized view stores results and refreshes them; a streaming table processes each row exactly once and appends; a **dynamic view** stores nothing and filters or masks per viewer with `current_user()` and `is_account_group_member()`. Know the clause names `SCHEDULE EVERY`, `SCHEDULE CRON … AT TIME ZONE`, `TRIGGER ON UPDATE` and `REFRESH MATERIALIZED VIEW … [ASYNC | FULL]`, and that refreshes are billed as serverless pipelines, not against the warehouse that submitted them.
