---
id: dataframe-columns-rows
title: Columns, rows, and DataFrame structure
area: foundations-python
level: beginner
summary: The PySpark operations for adding, renaming, dropping, and transforming columns, filtering rows, and exploding arrays, with their Spark SQL equivalents.
prerequisites: [medallion-architecture, semi-structured-data]
related: [dataframe-joins-unions, dataframe-dedup-aggregations]
exams:
  - cert: de-associate
    domain: "Data Transformation and Modeling"
    objective: "Manipulate columns, rows, and table structures by adding, dropping, splitting, renaming column names, applying filters, and exploding arrays."
sources:
  - url: https://docs.databricks.com/aws/en/pyspark/basics
    checked: 2026-09-09
aliases: [withColumn, explode, selectExpr, filter pyspark]
updated: 2026-09-09
status: published
---

## What it is

A PySpark DataFrame is a distributed, **immutable** table: every operation returns a new DataFrame without touching the original, and nothing actually runs until you ask for a result (`display`, `write`, `count`). This is the first stumbling block for anyone coming from pandas, where `df["x"] = …` modifies the object in place.

The operations covered here work along three axes: **columns** (add, rename, drop, transform), **rows** (filter), and **structure** (split strings into multiple columns, explode arrays into multiple rows).

## Why it exists

Bronze-to-silver cleanup (see [[medallion-architecture]]) is made up almost entirely of these operations. Data arrives with wrong column names, composite fields (`"Smith, John"`), nested arrays from JSON (see [[semi-structured-data]]), and rows you need to throw away. The same transformations can be written in SQL or in Python, and the exam asks for both forms.

## How it works

### Columns

| PySpark | Spark SQL | Notes |
| --- | --- | --- |
| `select("a", "b")` | `SELECT a, b` | projection |
| `selectExpr("a * 2 AS a2")` | `SELECT a * 2 AS a2` | SQL expressions as strings |
| `withColumn("c", expr)` | `SELECT *, expr AS c` | adds or replaces |
| `withColumns({"c": e1, "d": e2})` | `SELECT *, e1 AS c, e2 AS d` | multiple columns in one call |
| `withColumnRenamed("a", "b")` | `SELECT a AS b` | rename |
| `drop("a", "b")` | `SELECT * EXCEPT (a, b)` | removal |
| `col("a").cast("int")` | `CAST(a AS INT)` | typing |
| `lit(1)` | `1` | a constant as a column |
| `when(cond, x).otherwise(y)` | `CASE WHEN cond THEN x ELSE y END` | conditional |

Calling `withColumn` repeatedly in a loop produces a long plan that's hard to analyze; for dozens of columns, `withColumns` with a dictionary, or a single `select`, works better.

### Rows

`filter` and `where` are the same method. They accept a boolean `Column` (`col("amount") > 0`) or a SQL string (`"amount > 0"`). Compound conditions use `&`, `|`, `~`, and each condition needs parentheses, because in Python `&` binds tighter than the comparison operators.

### Structure

`split(col, pattern)` returns an array; `getItem(i)` or the `[i]` index pulls out one element. The pattern is a regex: to split on a literal dot you need `"\\."`.

`explode(array_col)` produces one row per array element and **drops** rows with an empty or null array. `explode_outer` keeps them, with `NULL`. `posexplode` also adds the position. In SQL you use `explode()` inside the `SELECT`, or `LATERAL VIEW explode(...)`.

## Example

A bronze table of events with a full name, a `tags` field as an array, and some test rows to discard.

```sql
SELECT
  event_id,
  split(full_name, ' ')[0]          AS first_name,
  split(full_name, ' ')[1]          AS last_name,
  CAST(amount AS DECIMAL(10, 2))    AS amount,
  CASE WHEN amount >= 100 THEN 'high' ELSE 'low' END AS tier,
  'web'                             AS source,
  tag
FROM shop.bronze.events
LATERAL VIEW explode(tags) AS tag
WHERE is_test = false AND amount IS NOT NULL;
```

```python
from pyspark.sql import functions as F

events = spark.read.table("shop.bronze.events")

parts = F.split(F.col("full_name"), " ")

silver = (
    events
    .filter((F.col("is_test") == False) & F.col("amount").isNotNull())
    .withColumns({
        "first_name": parts.getItem(0),
        "last_name": parts.getItem(1),
        "amount": F.col("amount").cast("decimal(10,2)"),
        "tier": F.when(F.col("amount") >= 100, "high").otherwise("low"),
        "source": F.lit("web"),
    })
    .withColumn("tag", F.explode("tags"))
    .withColumnRenamed("event_id", "id")
    .drop("full_name", "tags", "is_test")
)
```

If rows with no tags need to survive:

```python
silver = events.withColumn("tag", F.explode_outer("tags"))
```

And if you need to know each tag's original position:

```python
silver = events.select("event_id", F.posexplode("tags").alias("pos", "tag"))
```

Note the difference from pandas: there's no `df["tier"] = …`, there's no row index, and `df.columns` is a list of names, not a mutable object.

## Common mistakes

- Forgetting parentheses in `filter(col("a") > 1 & col("b") < 2)`: Python evaluates `1 & col("b")` first, and the error message is cryptic.
- Using `==` between Python strings instead of `col()`: `filter("a" == "b")` compares two Python strings, not columns.
- `explode` on a column with null arrays: rows silently disappear. Use `explode_outer` when they need to be kept.
- `split` on a regex special character (`.`, `|`) without escaping: returns empty arrays.
- `withColumnRenamed` on a column that doesn't exist: no error, it just does nothing.
- `cast` to an incompatible type with ANSI mode on (the default on serverless): the whole query fails instead of producing `NULL`. Use `try_cast` when dirty data is expected.

> [!exam]
> You're asked to recognize the right method for an action: add a column (`withColumn`), rename it (`withColumnRenamed`), drop it (`drop`), split a string (`split` + index), filter (`filter`/`where`), turn an array into rows (`explode`, with `explode_outer` to keep nulls). Expect the SQL version too: `CAST`, `CASE WHEN`, `split(...)[0]`, `explode()` or `LATERAL VIEW`.
