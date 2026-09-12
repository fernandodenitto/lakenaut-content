---
id: sql-window-functions
title: Window functions
area: foundations-sql
level: intermediate
summary: OVER, PARTITION BY, ranking and lag/lead functions, frame clauses, and QUALIFY - a Databricks convenience Postgres does not have.
prerequisites: [sql-joins-and-sets, dataframe-dedup-aggregations]
related: [sql-merge-and-dml, spark-ui-bottlenecks, gold-layer-objects]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-window-functions
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-qry-select-qualify
    checked: 2026-09-10
aliases: [over partition by, row_number, rank, dense_rank, lag, lead, qualify]
updated: 2026-09-10
status: published
---

## What it is

A window function computes a value per row using a set of "peer" rows - defined by `PARTITION BY` and `ORDER BY` - without collapsing them into one row the way `GROUP BY` does. Ranking a row within its group, comparing it to the previous row, or running a cumulative total are all window-function problems, and Spark SQL follows the same standard as Postgres here almost line for line - this is one of the rare corners of Databricks SQL that isn't a departure from what a Postgres background already teaches.

## Why it exists

Plenty of gold-layer questions are naturally "per row, relative to its group": the latest snapshot per key, this month versus last, a rank within a category. Doing that with a self-join or a correlated subquery works but is expensive and awkward to read; window functions express it directly, and on Databricks they're also the standard way to deduplicate a change-data-capture feed before a [[sql-merge-and-dml|MERGE]].

## How it works

**The shape.** `function(...) OVER (PARTITION BY key ORDER BY sort_col [frame])`. `PARTITION BY` splits rows into independent groups - omit it and the whole result set becomes one partition. `ORDER BY` fixes the order the function walks rows in within each partition; ranking functions require it.

**Ranking.** `ROW_NUMBER()` assigns a strictly increasing, unique number per partition regardless of ties. `RANK()` gives tied rows the same rank and then skips the following ones (1, 1, 3). `DENSE_RANK()` also ties rows together but never skips (1, 1, 2). Picking the wrong one is the classic bug in a "keep exactly one row per key" pattern: only `ROW_NUMBER()` guarantees a unique winner when values tie.

**LAG and LEAD.** `LAG(col, offset, default) OVER (...)` reads a value from `offset` rows before the current one within the partition; `LEAD` reads ahead. Both take an optional default for when there's no such row, useful for period-over-period comparisons without a self-join.

**Frame clauses.** `ROWS BETWEEN ... AND ...` counts physical rows - `ROWS BETWEEN 1 PRECEDING AND CURRENT ROW` is exactly the current row and the one before it. `RANGE BETWEEN ... AND ...` counts by the *value* of the `ORDER BY` expression instead, treating rows with an equal order value as peers - a distinction that only bites when the sort column has duplicates. Ranking functions can't take an explicit frame; aggregate window functions default to `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` when an `ORDER BY` is present.

**QUALIFY.** Filtering on a window function normally forces a wrapping subquery or CTE, because `WHERE` runs before window functions are computed. `QUALIFY` skips that, filtering directly on a window function's result in the same query. Databricks (and Snowflake) support it; Postgres and MySQL don't, so such a query needs rewriting with a CTE to run anywhere else.

**The dedup-latest pattern.** `ROW_NUMBER() OVER (PARTITION BY key ORDER BY updated_at DESC)` numbers each key's rows newest-first; `QUALIFY row_num = 1` (or a CTE plus `WHERE row_num = 1` on Postgres) keeps only the latest. It's the standard way to collapse a CDC feed with multiple versions of the same key before merging it into a table.

**The cost of skipping PARTITION BY.** Without a partition key, the entire result set is one partition, and Spark has to shuffle every row to a single task to compute order-dependent functions like `ROW_NUMBER` correctly - the job collapses from parallel to effectively single-threaded for that stage. It's the same shape of problem as a missing `GROUP BY` key, but easier to miss because the query still returns a correct answer, just slowly (see [[spark-ui-bottlenecks]]).

| | Databricks (Spark SQL) | Postgres |
|---|---|---|
| Core window syntax | standard, same as Postgres | standard |
| Filter on a window result | `QUALIFY` | CTE / subquery + `WHERE` |
| Missing `PARTITION BY` | shuffles everything to one task | slow on one core, no cluster-wide shuffle to worry about |

## Example

```sql
SELECT
  customer_id,
  order_id,
  updated_at,
  amount,
  RANK() OVER (PARTITION BY customer_id ORDER BY amount DESC) AS amount_rank,
  LAG(amount) OVER (PARTITION BY customer_id ORDER BY updated_at) AS prev_amount
FROM shop.silver.orders
QUALIFY ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY updated_at DESC) = 1;
```

```python
from pyspark.sql import functions as F, Window

w = Window.partitionBy("order_id").orderBy(F.col("updated_at").desc())

latest = (
    spark.table("shop.silver.orders")
    .withColumn("row_num", F.row_number().over(w))
    .filter("row_num = 1")
    .drop("row_num")
)
```

## Common mistakes

- Forgetting `PARTITION BY` entirely and turning a parallel job into a single-task bottleneck.
- Using `RANK()` for a "keep one row per key" dedup: ties produce more than one row with rank `1`.
- Writing `QUALIFY` in a query meant to also run on Postgres or a federated source that doesn't support it.
- Mixing up the window's `ORDER BY` (how the function walks rows) with the outer query's `ORDER BY` (how results are displayed) - you usually need both.
- Reaching for `RANGE BETWEEN` when `ROWS BETWEEN` was meant, and getting unexpected extra peer rows because the sort column has duplicates.

> [!tip]
> `QUALIFY ROW_NUMBER() OVER (PARTITION BY key ORDER BY updated_at DESC) = 1` is the standard way to collapse a CDC feed down to one row per key right before a [[sql-merge-and-dml|MERGE]].
