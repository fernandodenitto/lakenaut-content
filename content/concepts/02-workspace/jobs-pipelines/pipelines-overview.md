---
id: pipelines-overview
title: Lakeflow pipelines
area: jobs-pipelines
subarea: pipelines
level: intermediate
summary: A declarative pipeline describes streaming tables and materialized views in SQL or Python; the engine works out the graph, ordering and incremental updates. Formerly Delta Live Tables.
prerequisites: [jobs-overview, delta-lake-overview]
related: [pipelines-expectations, gold-layer-objects, auto-loader, medallion-architecture, jobs-overview, runs-monitoring]
exams:
  - cert: de-associate
    domain: "Working with Lakeflow Jobs"
    objective: "Configure common tasks (notebook, SQL query, dashboard, and pipeline tasks) and their dependencies using Lakeflow Jobs and its DAG-based task graph"
sources:
  - url: https://docs.databricks.com/aws/en/ldp/
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/ldp/concepts/
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/ldp/developer/python-ref
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/ldp/developer/python-dev
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/ldp/developer/sql-dev
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/ldp/updates
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/ldp/configure-pipeline
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/ldp/monitor-event-logs
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/release-notes/product/2025/june
    checked: 2026-09-09
aliases: [lakeflow pipelines, lakeflow spark declarative pipelines, sdp, delta live tables, dlt, ldp, lakeflow declarative pipelines, spark declarative pipelines, declarative pipelines, pipeline]
updated: 2026-09-11
status: published
---

> [!changed]
> This product used to be called **Delta Live Tables (DLT)**. In June 2025 it became *Lakeflow Declarative Pipelines*, in November 2025 *Lakeflow Spark Declarative Pipelines*, and the docs now call it simply **Lakeflow pipelines**. Underneath it runs the open-source *Apache Spark Declarative Pipelines* framework, which keeps that name. In the sidebar, the *Pipelines* entry merged into *Jobs & Pipelines*. In Python, the `dlt` module is deprecated but still works: the new import is `from pyspark import pipelines as dp`. Older notebooks still use `dlt` and `LIVE.`: it's the same product.

## What it is

A **declarative pipeline** is a set of SQL or Python files where you **declare the datasets** and the query that produces each one. Instead of writing "read, transform, write, repeat," you write "this table is the result of this query," and the engine works out the graph, the ordering, checkpointing, retries, and, where possible, incremental updates.

The objects in a pipeline:

| Object | What it is | When to use it |
| --- | --- | --- |
| **Streaming table** | a table fed by an *append-only* source; each record is processed exactly once | ingestion (Auto Loader, Kafka), incremental bronze and silver |
| **Materialized view** | a table whose content is the result of a query, recomputed or incrementally refreshed on each update | aggregations, joins, gold; sources with updates and deletes |
| **View** (temporary/private) | an unpublished intermediate query | breaking up logic, quality checks |
| **Flow** | the link from a source to a dataset; a streaming table can have several flows appending into it | merging multiple sources into the same table |

The choice between a streaming table and a materialized view is also covered in [[gold-layer-objects]].

## Why it exists

A hand-written Structured Streaming ETL means managing checkpoints, notebook ordering, retries, and schema changes yourself. A pipeline moves those problems onto the engine and adds **expectations** (quality rules, see [[pipelines-expectations]]), an event log, and the graph view. It's the natural tool for building a [[medallion-architecture]].

## How it works

### Defining datasets

In SQL you use `CREATE OR REFRESH STREAMING TABLE` and `CREATE OR REFRESH MATERIALIZED VIEW`. The `STREAM` keyword in the `FROM` clause tells the engine to read the source incrementally; without `STREAM`, the read is batch. In Python, the `pyspark.pipelines` module exposes the decorators `@dp.table` (streaming table, the function returns a stream), `@dp.materialized_view` (the function returns a batch DataFrame), and `@dp.temporary_view`. The decorators register the datasets and the engine builds the graph: a pipeline file **cannot be run interactively** — the module only exists inside a pipeline.

### Execution modes

| | Triggered (default) | Continuous |
| --- | --- | --- |
| Behavior | processes the data available at startup, then stops | stays up and processes data as it arrives |
| Compute | active only during the update | always on, higher cost |
| Use case | scheduled by a job, batch or micro-batch | low latency, continuous sources |

**Development** and **production** are no longer a toggle: updates launched from the UI use *development* behavior (compute reuse, no retries, errors surface immediately), while updates launched by a job or the API use *production* behavior (retries on recoverable errors, compute torn down at the end). The recommended compute is **serverless**.

A normal update appends new records to streaming tables and refreshes materialized views, incrementally where it can. A **full refresh** recomputes everything and resets checkpoints: risky if the source has already discarded old data. A **dry run** validates the definitions without materializing anything.

### A pipeline inside a job

A pipeline has no scheduler of its own: you orchestrate it with a **Pipeline** task in Lakeflow Jobs (see [[jobs-overview]]), which can request a full refresh and sits alongside notebook, SQL, and dashboard tasks in the same DAG.

### Event log

Every pipeline writes an **event log**: a Delta table hidden in the default catalog and schema, queryable with `event_log('<pipeline_id>')` or publishable as a Unity Catalog table. It holds `flow_progress` events (rows written and dropped, expectation metrics), `flow_definition` (lineage), `user_action`, and `planning_information`. It's the foundation for monitoring (see [[runs-monitoring]]).

## Example

Bronze streamed from JSON files with Auto Loader, silver streamed with an expectation, gold as a materialized view. SQL first, then the Python equivalent:

```sql
CREATE OR REFRESH STREAMING TABLE orders_bronze
AS SELECT * FROM STREAM read_files('/Volumes/main/landing/orders/', format => 'json');

CREATE OR REFRESH STREAMING TABLE orders_silver (
  CONSTRAINT valid_amount EXPECT (amount > 0) ON VIOLATION DROP ROW
)
AS SELECT order_id, customer_id, CAST(amount AS DECIMAL(12,2)) AS amount, order_date
FROM STREAM(orders_bronze);

CREATE OR REFRESH MATERIALIZED VIEW daily_sales
AS SELECT order_date, sum(amount) AS total
FROM orders_silver
GROUP BY order_date;
```

```python
from pyspark import pipelines as dp
from pyspark.sql import functions as F

@dp.table(name="orders_bronze")
def orders_bronze():
    return (spark.readStream.format("cloudFiles")
            .option("cloudFiles.format", "json")
            .load("/Volumes/main/landing/orders/"))

@dp.table(name="orders_silver")
@dp.expect_or_drop("valid_amount", "amount > 0")
def orders_silver():
    return (spark.readStream.table("orders_bronze")
            .select("order_id", "customer_id",
                    F.col("amount").cast("decimal(12,2)").alias("amount"),
                    "order_date"))

@dp.materialized_view(name="daily_sales")
def daily_sales():
    return (spark.read.table("orders_silver")
            .groupBy("order_date")
            .agg(F.sum("amount").alias("total")))
```

The pipeline and the job that runs it every night, in a bundle:

```yaml
resources:
  pipelines:
    orders:
      name: orders
      catalog: main
      schema: sales
      serverless: true
      continuous: false
      libraries:
        - glob: { include: ./transformations/** }
  jobs:
    nightly_orders:
      name: nightly_orders
      schedule: { quartz_cron_expression: "0 0 3 * * ?", timezone_id: UTC }
      tasks:
        - task_key: pipeline
          pipeline_task:
            pipeline_id: ${resources.pipelines.orders.id}
            full_refresh: false
```

## Common mistakes

- Running the pipeline notebook with "Run all": `pyspark.pipelines` doesn't exist outside a pipeline.
- Using `STREAM` in a materialized view, or batch-reading a source that should have been a streaming table: the first errors out, the second loses incrementality.
- Choosing a streaming table for a source with updates and deletes: streaming tables assume append-only sources; for changing data you need `AUTO CDC` or a materialized view.
- Running a full refresh on a streaming table fed by Kafka with short retention: the older data is gone for good.
- Writing `import dlt` and `LIVE.table` in new code: it works, but it's deprecated; in new pipelines `LIVE` is ignored.

> [!exam]
> The exam asks about the difference between a **streaming table** (append-only, incremental, each record processed once) and a **materialized view** (the result of a query, recomputed or refreshed on update), the `CREATE OR REFRESH STREAMING TABLE … AS SELECT … FROM STREAM …` and `CREATE OR REFRESH MATERIALIZED VIEW` syntax, and the fact that a pipeline runs inside a job via a **Pipeline task**. Know the naming: DLT, Delta Live Tables, Lakeflow Declarative Pipelines, Lakeflow Spark Declarative Pipelines and Lakeflow pipelines all refer to the same product (exam guides still use the older names); `triggered` and `continuous` are the two execution modes.
