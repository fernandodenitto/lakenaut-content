---
id: pipelines-expectations
title: "Data quality: expectations and constraints"
area: jobs-pipelines
subarea: pipelines
level: intermediate
summary: Declarative pipeline expectations (warn, drop, fail) and Delta NOT NULL and CHECK constraints. Where each one is declared, what happens on a violation, and how to read the metrics in the event log.
prerequisites: [pipelines-overview, medallion-architecture]
related: [gold-layer-objects, delta-lake-overview, runs-monitoring, dataframe-dedup-aggregations]
exams:
  - cert: de-associate
    domain: "Data Transformation and Modeling"
    objective: "Apply data quality checks and validation rules to ensure reliable Silver and Gold datasets."
sources:
  - url: https://docs.databricks.com/aws/en/ldp/expectations
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/tables/constraints
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/ldp/developer/python-ref
    checked: 2026-09-09
aliases: [expectations, data quality, constraint, expect_or_drop, on violation]
updated: 2026-09-11
status: published
---

## What it is

Databricks offers two mechanisms for saying "this data must satisfy a rule":

- **expectations** in Lakeflow pipelines (see [[pipelines-overview]]): rules declared on a dataset that the pipeline evaluates on every update, with three possible behaviors on violation and metrics recorded in the event log;
- Delta table **constraints**: `NOT NULL` and `CHECK`, enforced for anyone writing to the table, from any job. On violation, the transaction fails.

The former is a pipeline-level tool; the latter is a property of the table itself.

## Why it exists

Silver promises clean data and gold promises reliable numbers (see [[medallion-architecture]]). Without explicit rules, that promise only lives in the head of whoever wrote the code. Expectations make the rules declarative, visible in the pipeline UI, and measurable over time: you know that yesterday 0.2% of orders had a negative amount and today it's 4%. Delta constraints are the last line of defense: they block writes even from code that ignores the pipeline entirely.

## How it works

### Expectations

Every expectation has a **name**, a boolean **condition** in SQL syntax evaluated per row, and an **action**:

| Action | SQL | Python | Effect on the row | Effect on the update |
| --- | --- | --- | --- | --- |
| warn (default) | `CONSTRAINT name EXPECT (condition)` | `@dp.expect(name, condition)` | written anyway | continues; violations counted |
| drop | `... ON VIOLATION DROP ROW` | `@dp.expect_or_drop(name, condition)` | dropped | continues; drops counted |
| fail | `... ON VIOLATION FAIL UPDATE` | `@dp.expect_or_fail(name, condition)` | nothing written | the update fails, needs intervention |

In Python the current module is `from pyspark import pipelines as dp`; the old `import dlt` still works but isn't recommended. To apply several rules at once there's `@dp.expect_all`, `@dp.expect_all_or_drop`, and `@dp.expect_all_or_fail`, which take a `{name: condition}` dictionary you can reuse across datasets.

A practical rule of thumb per layer: no expectations in bronze, `drop` on unrecoverable rows and `warn` on things you just want to observe in silver, `fail` in gold on anything that would make the dashboard flat-out wrong.

### Metrics in the event log

Every update writes, per flow, the number of rows that passed and failed for each expectation to the pipeline's event log. You read it with the `event_log()` function, filtering on `flow_progress` events and the `details:flow_progress.data_quality.expectations` field. `fail` expectations don't produce metrics: they stop the update before it gets that far. A common pattern is **quarantine**: write the dropped rows to a separate table using an inverted expectation, so nothing is lost.

### Delta constraints

| Constraint | How to declare it | Enforced |
| --- | --- | --- |
| `NOT NULL` | in `CREATE TABLE` or `ALTER TABLE t ALTER COLUMN c SET NOT NULL` | yes |
| `CHECK` | `ALTER TABLE t ADD CONSTRAINT name CHECK (expression)` | yes |
| `PRIMARY KEY`, `FOREIGN KEY` | in `CREATE TABLE` or `ALTER TABLE` | **no**, informational only: they help the optimizer and serve as documentation |

Adding a `CHECK` to an already-populated table first validates the existing data: if a row violates it, the `ALTER` fails. Constraints are visible via `DESCRIBE DETAIL` or `SHOW TBLPROPERTIES` (the `delta.constraints.<name>` property).

## Example

Silver with pipeline expectations, gold protected by `fail`, and a Delta table with constraints.

```sql
CREATE OR REFRESH STREAMING TABLE silver_orders (
  CONSTRAINT valid_order_id EXPECT (order_id IS NOT NULL) ON VIOLATION DROP ROW,
  CONSTRAINT valid_amount   EXPECT (amount >= 0)          ON VIOLATION DROP ROW,
  CONSTRAINT known_channel  EXPECT (channel IN ('web', 'store', 'app'))
) AS
SELECT * FROM STREAM(shop.bronze.orders_raw);

CREATE OR REFRESH MATERIALIZED VIEW gold_revenue (
  CONSTRAINT positive_revenue EXPECT (revenue >= 0) ON VIOLATION FAIL UPDATE
) AS
SELECT channel, SUM(amount) AS revenue
FROM silver_orders
GROUP BY channel;
```

```python
from pyspark import pipelines as dp
from pyspark.sql import functions as F

silver_rules = {
    "valid_order_id": "order_id IS NOT NULL",
    "valid_amount": "amount >= 0",
}

@dp.table(name="silver_orders")
@dp.expect_all_or_drop(silver_rules)
@dp.expect("known_channel", "channel IN ('web', 'store', 'app')")
def silver_orders():
    return spark.readStream.table("shop.bronze.orders_raw")

@dp.materialized_view(name="gold_revenue")
@dp.expect_or_fail("positive_revenue", "revenue >= 0")
def gold_revenue():
    return spark.read.table("silver_orders").groupBy("channel").agg(F.sum("amount").alias("revenue"))
```

Quarantining dropped rows and reading the metrics:

```sql
CREATE OR REFRESH STREAMING TABLE silver_orders_quarantine (
  CONSTRAINT is_invalid EXPECT (NOT (order_id IS NOT NULL AND amount >= 0)) ON VIOLATION DROP ROW
) AS SELECT * FROM STREAM(shop.bronze.orders_raw);

SELECT timestamp,
       details:flow_progress.data_quality.expectations
FROM event_log(TABLE(shop.silver.silver_orders))
WHERE event_type = 'flow_progress'
ORDER BY timestamp DESC;
```

Delta constraints on a table written by regular jobs:

```sql
CREATE TABLE shop.silver.customers (
  customer_id BIGINT NOT NULL,
  email STRING,
  created_at DATE
);

ALTER TABLE shop.silver.customers
  ADD CONSTRAINT valid_email CHECK (email LIKE '%@%');

ALTER TABLE shop.silver.customers
  ALTER COLUMN email SET NOT NULL;
```

An `INSERT` with an email missing `@` fails with a `CHECK` violation error and nothing gets written: the Delta transaction is atomic.

## Common mistakes

- Using `FAIL UPDATE` in silver on a rule the source data violates as a matter of routine: the pipeline stops every night over a single record.
- Using only `warn` and never checking the event log: violations pile up and nobody notices.
- Confusing expectations with constraints: an expectation only applies inside the pipeline that declares it; a notebook writing to the same table doesn't see it. A Delta constraint applies to everyone.
- Relying on `PRIMARY KEY` to block duplicates: it's informational, not enforced. Deduplicate explicitly instead (see [[dataframe-dedup-aggregations]]).
- Adding a `CHECK` to a large table during peak hours: validating the existing data is a full scan.

> [!exam]
> You need to know the three behaviors and their syntax: warn (default, rows written and counted), `ON VIOLATION DROP ROW` / `expect_or_drop` (rows dropped), `ON VIOLATION FAIL UPDATE` / `expect_or_fail` (update stopped). Know that the metrics live in the event log, that `NOT NULL` and `CHECK` are the only enforced Delta constraints, and that primary and foreign keys are informational. Typical question: "which option drops invalid rows but lets the pipeline keep going?" → `ON VIOLATION DROP ROW`.
