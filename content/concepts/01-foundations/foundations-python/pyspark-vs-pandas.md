---
id: pyspark-vs-pandas
title: PySpark versus pandas
area: foundations-python
level: beginner
summary: Why PySpark code looks like pandas but behaves completely differently — lazy, distributed, and built around a DAG instead of an in-memory object.
prerequisites: [compute-options, spark-sql-basics]
related: [dataframe-columns-rows, python-in-notebooks, spark-tuning-basics]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/pyspark/basics
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/pandas/pandas-on-spark
    checked: 2026-09-10
aliases: [pandas vs spark, pyspark.pandas, koalas, toPandas, collect]
updated: 2026-09-10
status: published
---

## What it is

PySpark's `DataFrame` and pandas' `DataFrame` share a name and a lot of method names (`select`, `filter`, `groupby`...), but they are built on opposite execution models. A pandas DataFrame lives entirely in the memory of one process and every line of code runs immediately. A PySpark DataFrame is a **description of work** distributed across a cluster: nothing runs until you explicitly ask for a result.

This distinction is the single most common source of confusion for anyone who learned pandas first and then opens a Databricks notebook.

## Why it exists

pandas was designed for one machine and one core (mostly): it's fast and convenient as long as the data fits in the driver's RAM. Databricks exists to process data that doesn't fit on one machine, so PySpark needed a model where an *engine* — Catalyst and Spark's scheduler — can look at an entire chain of operations before running any of it, decide the best physical plan (partitioning, join strategy, filter pushdown), and spread the execution across many executors. That planning step only works if the engine sees the whole computation first, which is why PySpark is lazy by design and pandas isn't.

## How it works

PySpark methods split into two families:

| Kind | What it does | Runs immediately? | Examples |
| --- | --- | --- | --- |
| Transformation | Adds a step to the logical plan | No | `select`, `filter`, `withColumn`, `join`, `groupBy` |
| Action | Forces execution of the whole plan | Yes | `display`, `count`, `collect`, `write`, `toPandas` |

Every transformation returns a new DataFrame and builds up a **DAG** (directed acyclic graph) of steps. Nothing touches data until an action runs; at that point Spark optimizes the accumulated plan and schedules tasks across the executors. This means a stack of ten `withColumn` calls costs nothing until you call `display()` — and any typo in step three only surfaces when the action runs, not when you defined it.

`collect()` and `toPandas()` are actions with a specific danger: both pull **every row** from every executor back to the single driver process, as a Python list or a pandas DataFrame respectively. On a distributed dataset of any real size this either takes a long time or crashes the driver with an out-of-memory error — the driver has no more RAM than a single node, regardless of how big the cluster is. Use `limit(n)` before `collect()`/`toPandas()`, or aggregate first, unless you're certain the result is small.

The reverse direction is safe: `spark.createDataFrame(pandas_df)` takes an existing pandas DataFrame — small enough to already live on the driver — and distributes it into a Spark DataFrame.

For code that genuinely wants pandas syntax but Spark's scale, **pandas API on Spark** (`pyspark.pandas`, formerly Koalas) mimics pandas' interface on top of Spark DataFrames. It's convenient for exploratory work and plotting, but it doesn't cover the full pandas API, some operations that assume a stable row order or in-place mutation are slow or unsupported, and it still inherits Spark's distributed, mostly-lazy behavior underneath — it is not a drop-in replacement for every pandas script.

## Example

```sql
SELECT customer_id, SUM(amount) AS total
FROM shop.silver.orders
GROUP BY customer_id;
```

```python
# Nothing runs yet: this only builds a plan.
totals = (
    spark.read.table("shop.silver.orders")
    .groupBy("customer_id")
    .sum("amount")
    .withColumnRenamed("sum(amount)", "total")
)

# The action triggers the whole DAG.
totals.display()

# Safe: aggregated result is small.
totals_pdf = totals.toPandas()

# Distribute an existing pandas DataFrame back into Spark.
small_df = spark.createDataFrame(totals_pdf)

# pandas-flavored syntax, still distributed.
import pyspark.pandas as ps
psdf = totals.pandas_api()
psdf["total"].sum()
```

## Common mistakes

- Calling `.toPandas()` or `.collect()` on a full fact table "just to look at it" — use `.limit(20).toPandas()` or `display()` instead.
- Assuming `df["x"] = df["x"] * 2` works like pandas: PySpark DataFrames are immutable, there's no item assignment, only `withColumn`.
- Expecting an error at the line that has the bug: with lazy evaluation, the exception surfaces at the next action, not at the transformation that caused it.
- Treating `pyspark.pandas` as full pandas: some functions differ or aren't implemented, and row-order-dependent operations (like `iloc` by position across a whole distributed frame) don't map cleanly to a partitioned dataset.
- Choosing pandas for a job that will grow: a notebook that works today on a 2 GB sample will fail with the same code once the source table hits 200 GB.

> [!tip]
> Ask "does this need to scale past one machine's RAM?" first. If yes, PySpark (or SQL) DataFrames with lazy execution. If the data is genuinely small and stays that way — a lookup table, a config file — plain pandas is simpler and faster. `pyspark.pandas` is a bridge for people who think in pandas but need Spark's scale, not a way to avoid learning the DataFrame API in [[dataframe-columns-rows]].
