---
id: dataframe-dedup-aggregations
title: Deduplication and aggregations
area: foundations-python
level: beginner
summary: Removing duplicates with distinct, dropDuplicates, or a window function, and aggregating with groupBy/agg, count, approx_count_distinct, avg, describe, and summary.
prerequisites: [dataframe-columns-rows, medallion-architecture]
related: [dataframe-joins-unions, gold-layer-objects, pipelines-expectations]
exams:
  - cert: de-associate
    domain: "Data Transformation and Modeling"
    objective: "Perform data deduplication operations and aggregate operations on DataFrames, such as count, approximate count distinct, and mean, summary."
sources:
  - url: https://spark.apache.org/docs/latest/api/python/reference/pyspark.sql/api/pyspark.sql.DataFrame.dropDuplicates.html
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/pyspark/basics
    checked: 2026-09-09
aliases: [dropDuplicates, distinct, approx_count_distinct, groupBy, summary]
updated: 2026-09-09
status: published
---

## What it is

**Deduplication** removes repeated rows, either entirely or with respect to a subset of columns; **aggregation** summarizes groups of rows into a single value (count, average, distinct count). These are the operations that turn silver into a trustworthy dataset and gold into numbers the business can use.

## Why it exists

Duplicates show up everywhere: a job retry that rewrites the same batch, a source resending an event, CDC with multiple versions of the same record. Silver (see [[medallion-architecture]]) is where you decide the uniqueness key and the rule for which copy to keep. Aggregations, on the other hand, cost a shuffle: knowing when an approximation (`approx_count_distinct`) is good enough is a cost decision, not just a precision one.

## How it works

### Deduplication

| Method | What it compares | Which row survives |
| --- | --- | --- |
| `distinct()` | all columns | any one |
| `dropDuplicates()` | all columns | any one |
| `dropDuplicates(["k1", "k2"])` | only the listed columns | any one among those sharing the key |
| window + `row_number()` | the `partitionBy` columns | the one chosen by `orderBy` |

`distinct()` and `dropDuplicates()` with no arguments are equivalent to `SELECT DISTINCT`. With a `subset`, `dropDuplicates` doesn't guarantee which row survives: in a distributed system, "the first one" has no stable meaning. If keeping the **most recent** record matters, the only deterministic way is a window function with `row_number()` ordered by timestamp descending and a `= 1` filter.

In streaming, `dropDuplicates` has to keep state for every key it has ever seen; `dropDuplicatesWithinWatermark` limits that to the watermark window.

### Aggregations

`groupBy(...)` followed by `agg(...)` with functions from `pyspark.sql.functions`:

| Function | SQL | Notes |
| --- | --- | --- |
| `count("*")` | `COUNT(*)` | `count("col")` ignores nulls |
| `count_distinct("col")` | `COUNT(DISTINCT col)` | exact, requires a full shuffle; `countDistinct` is the legacy alias |
| `approx_count_distinct("col", rsd)` | `approx_count_distinct(col)` | HyperLogLog, default relative error of 5%, much cheaper |
| `avg("col")` / `mean("col")` | `AVG(col)` | synonyms |
| `sum`, `min`, `max`, `stddev` | same | |

`describe()` and `summary()` are exploratory shortcuts that return a DataFrame: `describe` computes count, mean, stddev, min, max; `summary` adds the 25th, 50th, and 75th percentiles and accepts a list of which statistics to compute. Neither is meant for gold tables: they're for understanding data in a notebook.

`groupBy(...).pivot("col")` turns a column's distinct values into columns. Passing the list of values as a second argument avoids an upfront scan.

## Example

Silver: keep the latest version of each order. Gold: metrics by channel.

```sql
CREATE OR REPLACE TABLE shop.silver.orders AS
SELECT * EXCEPT (rn)
FROM (
  SELECT *,
         ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY updated_at DESC) AS rn
  FROM shop.bronze.orders_raw
)
WHERE rn = 1;
```

```python
from pyspark.sql import functions as F
from pyspark.sql.window import Window

raw = spark.read.table("shop.bronze.orders_raw")

w = Window.partitionBy("order_id").orderBy(F.col("updated_at").desc())

latest = (
    raw
    .withColumn("rn", F.row_number().over(w))
    .filter("rn = 1")
    .drop("rn")
)

latest.write.mode("overwrite").saveAsTable("shop.silver.orders")
```

When the rule is simply "one row per key, doesn't matter which":

```python
deduped = raw.dropDuplicates(["order_id"])
```

Aggregation by channel:

```sql
SELECT
  channel,
  COUNT(*)                        AS orders,
  approx_count_distinct(customer_id) AS customers_approx,
  AVG(amount)                     AS avg_amount
FROM shop.silver.orders
GROUP BY channel;
```

```python
gold = (
    spark.read.table("shop.silver.orders")
    .groupBy("channel")
    .agg(
        F.count("*").alias("orders"),
        F.approx_count_distinct("customer_id").alias("customers_approx"),
        F.avg("amount").alias("avg_amount"),
    )
)
```

Quick stats in a notebook, and a pivot:

```python
spark.read.table("shop.silver.orders").select("amount").summary("count", "mean", "50%", "max").show()

by_month = (
    spark.read.table("shop.silver.orders")
    .groupBy("channel")
    .pivot("order_month", ["2026-07", "2026-08"])
    .agg(F.sum("amount"))
)
```

Compared to pandas, `groupBy` doesn't produce an index: the result is a plain DataFrame with the grouping columns. And `count()` with no `groupBy` is an **action** that returns an integer, not a column.

## Common mistakes

- Using `dropDuplicates(["order_id"])` and assuming it keeps the most recent version: it isn't guaranteed. You need the window.
- Running `count_distinct` on hundreds of millions of rows for a dashboard counter: it costs a full shuffle when `approx_count_distinct` would be enough.
- `count("col")` instead of `count("*")`: nulls aren't counted, and the total looks wrong.
- `pivot` without a list of values: Spark has to read the data twice, and it isn't supported in streaming at all.
- Confusing `df.count()` (an action, returns a number) with `F.count()` (an aggregate function, returns a column).

> [!exam]
> Typical questions: "how do you remove duplicates considering only some columns?" (`dropDuplicates(subset)`); "how do you count distinct values cheaply on a huge table?" (`approx_count_distinct`); "which method returns percentiles beyond mean and standard deviation?" (`summary`, not `describe`); "how do you keep the most recent record per key?" (a window with `row_number` and a filter). Remember that `distinct()` and `dropDuplicates()` with no arguments do the same thing.
