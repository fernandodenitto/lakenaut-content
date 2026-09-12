---
id: sql-data-types
title: Types and casting
area: foundations-sql
level: beginner
summary: The Spark SQL type system, CAST versus TRY_CAST under ANSI mode, DECIMAL precision limits, and how timestamps carry a time zone.
prerequisites: [spark-sql-basics, semi-structured-data]
related: [sql-joins-and-sets, dataframe-columns-rows, sql-window-functions]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-datatypes
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/sql/language-manual/functions/cast
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/sql/language-manual/data-types/decimal-type
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-ansi-compliance
    checked: 2026-09-10
aliases: [cast, try_cast, decimal type, timestamp_ntz, variant type]
updated: 2026-09-10
status: published
---

## What it is

Spark SQL's type system covers the usual numeric, string, and temporal types, plus complex types (`ARRAY`, `MAP`, `STRUCT`) and `VARIANT` for semi-structured values (see [[semi-structured-data]]). Types matter more here than in a row-store: Delta stores data column-by-column in Parquet, and the planner uses declared types to prune files and push predicates down before any data is read.

## Why it exists

A distributed engine has to agree on a value's type before it can decide how to encode it on disk, compare it across partitions, or fail a query safely instead of corrupting a nightly job. That's why casting rules are stricter than in a permissive dialect: an ambiguous conversion is a bug waiting to happen at scale, not a one-off to shrug off in a spreadsheet-sized table.

## How it works

**The type list.** `STRING`, `BOOLEAN`, `BINARY`; the integrals `TINYINT`, `SMALLINT`, `INT`, `BIGINT`; `DECIMAL(p,s)` and the approximate `FLOAT`/`DOUBLE`; `DATE`, `TIMESTAMP`, `TIMESTAMP_NTZ`; the complex types `ARRAY<T>`, `MAP<K,V>`, `STRUCT<...>`; and `VARIANT` for values whose shape isn't known upfront.

**CAST vs TRY_CAST.** `CAST(expr AS type)` converts a value and, under ANSI mode (on by default), raises an error on overflow or an unparsable value - `CAST('abc' AS INT)` fails rather than returning `NULL` the way older Hive-style SQL did. `TRY_CAST(expr AS type)` runs the same conversion but returns `NULL` on failure instead of raising, which is what you want when cleaning messy source data instead of validating it.

**Implicit casting.** Spark widens automatically along a safe path - `TINYINT → INT → BIGINT → DECIMAL → FLOAT → DOUBLE`, and `DATE → TIMESTAMP` - when an expression mixes types, following a documented compatibility matrix. It does **not**, however, implicitly turn a `STRING` into a number the way MySQL's non-strict mode will coerce `'5' = 5` or truncate `'abc'` into `0` on insert; under ANSI mode a `STRING` used where a number is expected either needs an explicit cast or fails.

**DECIMAL precision.** `DECIMAL(p, s)` allows a precision `p` up to 38 total digits and a scale `s` between 0 and `p`; the bare `DECIMAL` defaults to `DECIMAL(10, 0)`. Arithmetic between decimals can grow the result's precision and scale, and under ANSI mode an operation that would exceed 38 digits raises `CAST_OVERFLOW` / `ARITHMETIC_OVERFLOW` instead of silently rounding.

**Timestamps and time zones.** `TIMESTAMP` stores an absolute instant (UTC internally) and is displayed converted to the session's `spark.sql.session.timeZone` - conceptually close to Postgres' `timestamptz`. `TIMESTAMP_NTZ` stores a wall-clock value with no zone attached and is never converted on display or comparison - the equivalent of Postgres' plain `timestamp`. Mixing the two across a join on event time is a common source of off-by-some-hours bugs.

| | Databricks (Spark SQL) | Postgres |
|---|---|---|
| Text | `STRING`, no enforced length | `TEXT`, `VARCHAR(n)` with enforced length |
| Arbitrary precision numeric | `DECIMAL(p,s)`, max 38 digits | `NUMERIC`, effectively unbounded |
| Semi-structured | `VARIANT` | `JSONB`, indexable with GIN |
| Zoned timestamp | `TIMESTAMP` (session tz on display) | `TIMESTAMPTZ` (session tz on display) |
| Naive timestamp | `TIMESTAMP_NTZ` | `TIMESTAMP` |
| Auto-increment | `IDENTITY` column | `SERIAL` / `BIGSERIAL` |
| Bad cast | errors under ANSI mode (`CAST`) or `NULL` (`TRY_CAST`) | errors, no permissive mode |

## Example

```sql
SELECT
  CAST('42' AS INT)              AS ok_cast,
  TRY_CAST('not-a-number' AS INT) AS safe_null,
  CAST(19.999 AS DECIMAL(4,1))   AS rounded,
  CAST('2026-09-10 08:00:00' AS TIMESTAMP)      AS with_session_tz,
  CAST('2026-09-10 08:00:00' AS TIMESTAMP_NTZ)  AS naive
FROM VALUES (1);
```

```python
from pyspark.sql import functions as F
from pyspark.sql.types import DecimalType

df = spark.range(1).select(
    F.expr("try_cast('not-a-number' AS INT)").alias("safe_null"),
    F.lit(19.999).cast(DecimalType(4, 1)).alias("rounded"),
)
```

## Common mistakes

- Expecting `CAST` to return `NULL` on bad input the way pre-ANSI Hive/Spark used to - reach for `TRY_CAST` instead.
- Chaining decimal arithmetic without checking the resulting precision, then hitting an overflow error in production months later when a value finally gets large enough.
- Using `TIMESTAMP` and `TIMESTAMP_NTZ` interchangeably across a join key spanning time zones.
- Assuming `VARIANT` is indexed like Postgres `JSONB` - it isn't; filtering still relies on file-level pruning, not a secondary index.
- Expecting a bare `DECIMAL` to have unlimited precision like Postgres `NUMERIC`.

> [!tip]
> When ingesting messy external data, cast with `TRY_CAST` and quarantine the resulting `NULL`s explicitly, rather than letting a strict `CAST` blow up an otherwise-working pipeline at 3 a.m.
