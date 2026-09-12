---
id: pipelines-sql-vs-python
title: Choosing SQL or Python for a pipeline
area: jobs-pipelines
subarea: pipelines
level: intermediate
summary: "Both pipeline interfaces build the same dataflow graph, so most of the choice is taste. The asymmetries are few and they all run one way: Python covers the whole feature set, SQL does not."
prerequisites: [pipelines-overview]
related:
  [
    pipelines-sinks,
    pipelines-auto-cdc,
    materialized-views-sql,
    udfs-and-alternatives,
    pipelines-expectations,
  ]
exams:
  - cert: de-professional
    domain: "Developing Code for Data Processing using Python and SQL"
    objective: "Choose between the SQL and Python interfaces when building pipelines with Lakeflow Spark Declarative Pipelines."
sources:
  - url: https://docs.databricks.com/aws/en/ldp/developer/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/ldp/developer/sql-vs-python
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/ldp/developer/sql-dev
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/ldp/developer/python-dev
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/ldp/dbsql/dbsql-for-ldp
    checked: 2026-09-12
aliases:
  [
    sql vs python,
    pipelines python module,
    pyspark.pipelines,
    dlt module,
    import dlt,
    dp module,
    choose between sql and python,
  ]
updated: 2026-09-12
status: published
---

## What it is

A Lakeflow pipeline (see [[pipelines-overview]]) can be written in SQL or in Python. Both interfaces compile to the same underlying dataflow graph, so for most data processing they are genuinely equivalent: the same streaming tables, the same materialized views, the same incremental behaviour, the same event log. What differs is flexibility and feature coverage, and the gap runs in one direction. Python covers the full feature set; SQL does not.

A single pipeline can contain both, as long as **each language lives in its own source file**. Bronze and silver in Python and gold in SQL is a supported layout, not a workaround.

## Why it exists

Two audiences. Analysts and analytics engineers already think in `CREATE OR REFRESH MATERIALIZED VIEW`, and a bronze-to-silver-to-gold chain of declarative statements is the clearest thing they can hand to whoever maintains it next. Data engineers generating forty near-identical flows from a config table want a programming language.

The trap is choosing on familiarity alone. Choosing Python because you know Python costs nothing, because Python covers everything. Choosing SQL because you know SQL can walk you into a rewrite three months in, when the requirement arrives that SQL cannot express. Databricks' own guidance is in that order: if you can express the logic in SQL, use SQL; if you need programmatic control or a Python-only feature, use Python; and if you are more comfortable in Python, that alone is reason enough, because the reverse is not true.

## How it works

### The current Python names

All the pipeline APIs live in the `pyspark.pipelines` module, imported at the top of every Python source file. The convention in the documentation, and the one worth copying, is `dp`:

```python
from pyspark import pipelines as dp
```

This changed. The old module was `dlt`, with `@dlt.table` and `LIVE.` references; it is deprecated but still works, so older notebooks keep running unchanged. Apache Spark 4.1 ships declarative pipelines as `pyspark.pipelines`, and code written against the open-source module runs on Databricks without modification. Three things in the Databricks version are not part of Apache Spark: `dp.create_auto_cdc_flow`, `dp.create_auto_cdc_from_snapshot_flow`, and `@dp.expect(...)`.

The decorators and functions you will use: `@dp.table` for a streaming table, `@dp.materialized_view`, `@dp.temporary_view`, `dp.create_streaming_table`, `@dp.append_flow`, `dp.create_auto_cdc_flow`, `dp.create_auto_cdc_from_snapshot_flow`, `dp.create_sink`, `@dp.foreach_batch_sink`, and the `@dp.expect*` family. A function that defines a dataset must **return** a DataFrame and must not have side effects: no `collect()`, no `count()`, no `saveAsTable()`. The runtime reads your decorators to build the graph, then runs the queries itself, in its own order.

### What is the same in both

Streaming tables, materialized views, temporary views, private tables, expectations, flows, and Auto CDC. The vocabulary maps one to one:

| Feature           | SQL                                                                  | Python                                                                                        |
| ----------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Streaming table   | `CREATE OR REFRESH STREAMING TABLE`                                  | `@dp.table()`, `dp.create_streaming_table()`                                                  |
| Materialized view | `CREATE OR REFRESH MATERIALIZED VIEW`                                | `@dp.materialized_view()`                                                                     |
| Temporary view    | `CREATE TEMPORARY VIEW`                                              | `@dp.temporary_view()`                                                                        |
| Private table     | `CREATE PRIVATE STREAMING TABLE`, `CREATE PRIVATE MATERIALIZED VIEW` | `@dp.table(private=True)`                                                                     |
| Named flow        | `CREATE FLOW`                                                        | `@dp.append_flow()`                                                                           |
| Auto CDC          | `AUTO CDC ... INTO`                                                  | `dp.create_auto_cdc_flow()`                                                                   |
| Expectations      | `CONSTRAINT ... EXPECT`                                              | `@dp.expect()`, `@dp.expect_or_drop()`, `@dp.expect_or_fail()`, and the `expect_all` variants |

One syntactic asymmetry inside the equivalence: in SQL the `STREAM` keyword on the source decides whether the read is streaming, while in Python it is `spark.readStream` versus `spark.read`. Everything else about the two definitions can be identical.

### The real asymmetries

**Python only, no SQL at all:**

- **Sinks.** `create_sink()` and `@dp.foreach_batch_sink()`, and therefore any write to Kafka, Event Hubs, an external Delta table or a custom destination. See [[pipelines-sinks]].
- **Auto CDC from a snapshot.** `create_auto_cdc_from_snapshot_flow()` has no `AUTO CDC` counterpart for snapshot sources. See [[pipelines-auto-cdc]].
- **Loops, conditionals and metaprogramming.** Generating flows from a config table or a dictionary by wrapping the decorators in a factory function. Because the decorated inner functions are evaluated lazily by the runtime, calling the factory several times with different arguments registers several flows without duplicating code. The open-source `sdp-meta` library builds a metadata-driven framework on the same idea.
- **External Python libraries**, whether from PyPI or a wheel.
- **Python UDFs.** You can only define them in Python, although once defined you can call them from SQL source files in the same pipeline. See [[udfs-and-alternatives]].

**SQL only:**

- **Iceberg-compatible materialized views**, through `CREATE MATERIALIZED VIEW ... USING ICEBERG`, which has no Python equivalent. This one is in Public Preview.
- **Standalone tables.** A streaming table or materialized view created outside any pipeline, from a SQL warehouse or a serverless notebook, with Databricks managing the pipeline underneath. You author these in SQL, and the documentation's decision table sends the standalone case to SQL. See [[materialized-views-sql]]. In the event log such a pipeline shows up with `origin.pipeline_type = 'DBSQL'` (see [[pipelines-event-log]]).

Note that the Iceberg gap and the standalone path are narrow. The Python-only list is the one that decides architectures.

## Example: the same silver table twice, then something SQL cannot do

```sql
CREATE OR REFRESH STREAMING TABLE silver_orders (
  CONSTRAINT valid_amount EXPECT (amount >= 0) ON VIOLATION DROP ROW
) AS
SELECT order_id, customer_id, CAST(amount AS DECIMAL(12,2)) AS amount, event_ts
FROM STREAM main.bronze.orders_raw;
```

```python
from pyspark import pipelines as dp
from pyspark.sql import functions as F

@dp.table(name="silver_orders")
@dp.expect_or_drop("valid_amount", "amount >= 0")
def silver_orders():
    return (spark.readStream.table("main.bronze.orders_raw")
            .select("order_id", "customer_id",
                    F.col("amount").cast("decimal(12,2)").alias("amount"),
                    "event_ts"))
```

Identical graph, identical incremental behaviour, identical event log entries. Pick on readability.

Now the case that has no SQL form: one streaming table per region, generated from a list, each with its own filter and its own expectation threshold.

```python
from pyspark import pipelines as dp

REGIONS = {"emea": 10, "amer": 25, "apac": 5}

def make_region_table(region: str, min_amount: int):
    @dp.table(name=f"silver_orders_{region}")
    @dp.expect_or_drop("above_floor", f"amount >= {min_amount}")
    def _region_table():
        return (spark.readStream.table("main.silver.silver_orders")
                .where(f"region = '{region}'"))

for region, min_amount in REGIONS.items():
    make_region_table(region, min_amount)
```

Swap `REGIONS` for a read of a config table and the pipeline becomes metadata-driven. In SQL you would write the same block three times, and four times next quarter.

## Common mistakes

- **Choosing SQL for familiarity, then hitting a Python-only feature.** The usual trigger is a sink or a snapshot CDC source. You do not have to rewrite the pipeline: add a Python source file alongside the SQL ones.
- **Putting both languages in one file.** A pipeline mixes SQL and Python across files, never inside one. Each source file is one language.
- **Still importing `dlt` in new code.** It works, but the current module is `pyspark.pipelines`. Mixing `dlt` and `dp` conventions across a repository is how you get a codebase nobody wants to touch.
- **Calling an action inside a dataset function.** `count()`, `collect()`, `display()` or `saveAsTable()` in a function decorated with `@dp.table` produces behaviour you did not ask for. Return the DataFrame and let the runtime execute it.
- **Assuming file order is execution order.** In both languages the runtime reads every definition in every source file first, builds the graph, and then decides the order. Source order controls evaluation, not execution.
- **Reaching for a Python UDF because the pipeline is in Python.** The cost of a UDF is the same here as anywhere. Try the built-in functions first.

> [!exam]
> The Professional guide asks you to develop pipeline code in both languages, so know the mapping in both directions and the exceptions. The exceptions that get tested are the Python-only ones: `create_sink()`, `foreach_batch_sink()` and `create_auto_cdc_from_snapshot_flow()` have no SQL syntax, and neither do loops or metaprogramming. Know that the current import is `from pyspark import pipelines as dp`, that `dlt` is the deprecated predecessor, and that a pipeline can hold both languages provided each source file is one language.
