---
id: udfs-and-alternatives
title: UDFs and when not to write one
area: foundations-python
level: intermediate
summary: The real cost of a Python UDF versus built-in functions, pandas UDFs, and Unity Catalog functions, ranked from cheapest to most expensive.
prerequisites: [dataframe-columns-rows, spark-tuning-basics]
related: [spark-ui-bottlenecks, dataframe-dedup-aggregations, unity-catalog-overview]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/udf/
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/udf/pandas
    checked: 2026-09-10
aliases: [python udf, pandas udf, applyInPandas, ai_query, vectorized udf]
updated: 2026-09-10
status: published
---

## What it is

A user-defined function (UDF) is custom logic you register so Spark can call it inside a query, for cases the built-in functions don't cover. The mistake most people coming from pandas or plain Python make is reaching for a UDF as the *first* option, because that's the natural way to express custom logic — on Spark it's usually the most expensive one.

## Why it exists

Built-in functions (`pyspark.sql.functions`, or native SQL expressions) are understood by Catalyst: the optimizer can reorder them, push them past filters, and generate JVM bytecode for them. A Python UDF is a black box — Catalyst just knows "call this function per row" and can't optimize through it. UDFs exist because sometimes there's genuinely no built-in equivalent, but they're a last resort, not a default tool.

## How it works

### The cost order

| Option | Where it runs | Optimized by Catalyst | Typical cost |
| --- | --- | --- | --- |
| Built-in function / SQL expression | JVM, vectorized | Yes | Lowest |
| `ai_query()` as a function call | Model serving endpoint | Partially (still a function call, but no Python process per row) | Low–medium (network/model latency, not per-row Python) |
| Unity Catalog SQL function | JVM (SQL body) or Python, governed | SQL: yes; Python: no | Medium |
| Pandas UDF (`@pandas_udf`) / `applyInPandas` | Python, vectorized via Arrow | No, but batched | Medium |
| Python scalar UDF (`@udf`) | Python, one row at a time | No | Highest |

### Python scalar UDFs

`@udf(returnType=...)` wraps a plain Python function. For every row, Spark serializes the value, ships it out of the JVM to a Python process, runs the function, and serializes the result back. That round trip, repeated per row, is why a Python UDF is routinely 10–100x slower than an equivalent built-in expression on the same data.

### Pandas UDFs and Arrow

`@pandas_udf` functions receive and return pandas `Series` (or iterators of them), operating on a whole batch of rows at once instead of one at a time. Apache Arrow handles the serialization between the JVM and Python in a columnar, batched format, which is what makes pandas UDFs dramatically cheaper than scalar UDFs — still Python, but Python invoked thousands of times less often. `applyInPandas` extends the same idea to grouped operations: instead of `groupBy().agg()` with built-in aggregations, each group is handed to Python as a full pandas DataFrame and the function returns a transformed pandas DataFrame back.

### Unity Catalog functions and SQL UDFs

`CREATE FUNCTION catalog.schema.fn(...) RETURNS ... RETURN ...` registers a function inside Unity Catalog rather than inside one notebook session. The benefit isn't primarily speed — it's governance: the function has an owner, grants, and lineage, and can be reused from SQL, another notebook, or a job without copy-pasting the definition. A SQL-bodied UC function is still plain SQL, so Catalyst optimizes it normally; a Python-bodied one pays the same per-row cost as any Python UDF, just centrally governed.

### `ai_query` as a UDF replacement

For logic that used to mean writing a Python UDF that calls an external model or does NLP-ish text processing, `ai_query()` calls a model-serving endpoint directly from SQL or PySpark as a function, batched by Spark. It replaces a whole class of custom UDFs — classification, extraction, summarization — without you writing or maintaining the Python function.

## Example

```sql
-- Built-in: cheapest.
SELECT customer_id, UPPER(TRIM(email)) AS email_clean
FROM shop.silver.customers;
```

```python
from pyspark.sql import functions as F

# Built-in: prefer this whenever possible.
customers = customers.withColumn("email_clean", F.upper(F.trim("email")))

# Pandas UDF: only when the logic genuinely needs a Python/pandas library.
from pyspark.sql.functions import pandas_udf
import pandas as pd

@pandas_udf("string")
def normalize_phone(numbers: pd.Series) -> pd.Series:
    return numbers.str.replace(r"\D", "", regex=True)

customers = customers.withColumn("phone_clean", normalize_phone("phone"))

# applyInPandas: per-group custom logic that doesn't fit built-in aggregations.
def top_n(pdf: pd.DataFrame) -> pd.DataFrame:
    return pdf.sort_values("amount", ascending=False).head(3)

top_orders = orders.groupBy("customer_id").applyInPandas(top_n, schema=orders.schema)
```

## Common mistakes

- Writing a Python scalar UDF for something `pyspark.sql.functions` already has (string manipulation, date math, conditionals) — check the built-in list first.
- Not adding a `returnType` to `@udf`: Spark defaults to `StringType`, which silently stringifies numeric or struct results.
- Using `applyInPandas` for something a plain `groupBy().agg()` could do — it forces a full shuffle plus a Python round trip per group.
- Registering a Python UDF only in the notebook session (`spark.udf.register`) when other jobs need the same logic — a Unity Catalog function makes it reusable and governed instead of copy-pasted.
- Forgetting that a Python-bodied UC function is still a Python UDF performance-wise: the governance win doesn't remove the per-row cost.

> [!tip]
> Reach for a UDF only after checking `pyspark.sql.functions` and SQL built-ins have nothing equivalent. When you do need custom logic, prefer a pandas UDF over a scalar one, and register it as a Unity Catalog function if more than one notebook or job will use it.
