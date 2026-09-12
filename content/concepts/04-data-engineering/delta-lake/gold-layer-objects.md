---
id: gold-layer-objects
title: "Gold objects: tables, views, materialized views, streaming tables"
area: delta-lake
level: intermediate
summary: The four objects you use to expose the gold layer in Unity Catalog. What they store, how they refresh, what they cost, and when to pick one over another.
prerequisites: [medallion-architecture, delta-lake-overview]
related: [pipelines-overview, unity-catalog-overview, dataframe-dedup-aggregations, pipelines-expectations]
exams:
  - cert: de-associate
    domain: "Data Transformation and Modeling"
    objective: "Understand the difference between, and how to build, Gold layer objects such as materialized views, views, streaming tables, and tables for BI and analytics teams in Unity Catalog."
sources:
  - url: https://docs.databricks.com/aws/en/views/
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/views/materialized
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/dlt/streaming-tables
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-ddl-create-streaming-table
    checked: 2026-09-09
aliases: [materialized view, streaming table, view, gold layer, MV]
updated: 2026-09-09
status: published
---

## What it is

Gold is the layer that dashboards, analysts, and models read from (see [[medallion-architecture]]). In Unity Catalog you can expose it through four different objects, all queried with a plain `SELECT` but with very different behavior underneath:

| Object | Stores data | How it refreshes | Main cost | Use case |
| --- | --- | --- | --- | --- |
| **Table** (Delta) | yes | your job rewrites it or runs a `MERGE` | the job that produces it | full control, complex logic, history |
| **View** | no, only the query | always current: recomputed on every read | every read pays for the query | renaming, filtering, hiding columns, security |
| **Materialized view** | yes | manual, scheduled, or triggered refresh; incremental when possible | the refresh (serverless pipeline) | aggregates read often by BI |
| **Streaming table** | yes | processes each input row exactly once | the incremental refresh | ingestion and low-latency append-only data |

## Why it exists

An aggregate for a dashboard can be a view (simple, but recomputed on every click), a table (fast, but you need a job to maintain it), or a materialized view (fast and maintained by the platform). The choice is a trade-off between freshness, read cost, and maintenance cost. Streaming tables answer a different problem: data that keeps arriving and must be appended without re-reading everything.

## How it works

### View

A view stores only the text of its query, with name resolution done at creation time. Readers need `SELECT` on the view and `USE CATALOG`/`USE SCHEMA` on the containers, not on the underlying tables: that's why it's the basic tool for restricting access. **Temporary views** live in the notebook session and are not registered in the catalog.

### Materialized view

A materialized view is a managed table that holds the result of its query. When you create it or refresh it with `REFRESH MATERIALIZED VIEW`, Databricks spins up a dedicated **serverless pipeline**: the cost depends on the data processed, not on the warehouse. If the sources are Delta tables with row tracking, the refresh is **incremental** (only changed rows); otherwise it recomputes everything. It can be scheduled (`SCHEDULE EVERY 1 DAY`, `SCHEDULE CRON ...`) or tied to source updates (`TRIGGER ON UPDATE`). It also correctly recomputes joins when a dimension changes. Limits: no time travel, no identity columns.

### Streaming table

A streaming table is a Delta table that reads from a streaming source (`STREAM read_files(...)`, `STREAM read_kafka(...)`, `STREAM(table)`) and processes each input row **exactly once**. A change to the query applies only to future rows; to reprocess history you need `REFRESH TABLE ... FULL`, which is discouraged on short-retention sources such as Kafka. Joins with dimensions do **not** update when the dimension changes: that's the key difference from a materialized view. It works in Databricks SQL with Unity Catalog and inside pipelines (see [[pipelines-overview]]); on a classic cluster the syntax is only parsed, not executed.

### Table

A regular Delta table written by a job remains the right choice when the logic can't be expressed as a single query, when you need a `MERGE` with custom rules, or when you want time travel and clones (see [[delta-lake-overview]]).

### Compared with Postgres

In Postgres a view is identical, but a materialized view refreshes only through a manual `REFRESH MATERIALIZED VIEW` and always in full; there are no native scheduled or incremental refreshes, and there is no equivalent of a streaming table.

## Example

The same aggregate exposed three ways, plus a streaming table for ingestion.

```sql
-- View: no data stored, recomputed on every read
CREATE OR REPLACE VIEW shop.gold.v_revenue_by_channel AS
SELECT channel, SUM(amount) AS revenue
FROM shop.silver.orders
GROUP BY channel;

-- Materialized view: refreshed nightly, incrementally when possible
CREATE OR REPLACE MATERIALIZED VIEW shop.gold.mv_revenue_by_channel
SCHEDULE CRON '0 0 3 * * ?' AT TIME ZONE 'Europe/Rome'
AS
SELECT channel, SUM(amount) AS revenue
FROM shop.silver.orders
GROUP BY channel;

REFRESH MATERIALIZED VIEW shop.gold.mv_revenue_by_channel;

-- Streaming table: appends new files exactly once
CREATE OR REFRESH STREAMING TABLE shop.bronze.orders_raw
SCHEDULE EVERY 1 HOUR
AS SELECT *, current_timestamp() AS _ingested_at
FROM STREAM read_files('/Volumes/shop/landing/orders/', format => 'json');

-- Table: produced by a job
CREATE OR REPLACE TABLE shop.gold.revenue_by_channel AS
SELECT channel, SUM(amount) AS revenue
FROM shop.silver.orders
GROUP BY channel;
```

The same objects in a Python pipeline (see [[pipelines-overview]]):

```python
from pyspark import pipelines as dp
from pyspark.sql import functions as F

@dp.materialized_view(name="mv_revenue_by_channel")
def revenue():
    return spark.read.table("shop.silver.orders").groupBy("channel").agg(F.sum("amount").alias("revenue"))

@dp.table(name="orders_raw")
def orders_raw():
    return spark.readStream.format("cloudFiles").option("cloudFiles.format", "json").load("/Volumes/shop/landing/orders/")
```

## Common mistakes

- Using a view over a heavy aggregate read by a dashboard with a hundred users: every open recomputes the `GROUP BY`.
- Expecting a streaming table to reflect an update to a joined dimension: it doesn't; you need a materialized view.
- Running `REFRESH ... FULL` on a streaming table fed by Kafka with 7-day retention: everything older is lost.
- Trying `SELECT ... VERSION AS OF` on a materialized view: time travel is not supported.
- Creating a materialized view "to save money" without looking at the refresh cost: if the sources don't allow incremental refresh, every refresh is a full recompute.

> [!exam]
> The questions are "pick the right object": a dashboard reading an aggregate many times a day → materialized view; hiding columns or applying a filter without copying data → view; incremental ingestion of continuously arriving files → streaming table; custom logic with `MERGE` → table. Remember the three facts that separate MVs from streaming tables: an MV can recompute joins when a dimension changes, a streaming table processes each row exactly once, and both run on serverless pipelines.
