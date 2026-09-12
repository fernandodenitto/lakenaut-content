---
id: sql-joins-and-sets
title: Joins and set operations
area: foundations-sql
level: beginner
summary: Join types including LEFT SEMI and LEFT ANTI, USING versus ON, join hints, and why a Spark SQL join means a shuffle across machines, not a local scan.
prerequisites: [sql-data-types, dataframe-joins-unions]
related: [spark-tuning-basics, spark-ui-bottlenecks, sql-window-functions]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-qry-select-join
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-qry-select-setops
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-qry-select-hints
    checked: 2026-09-10
aliases: [left semi join, left anti join, join hints, union all, intersect, except]
updated: 2026-09-10
status: published
---

## What it is

Joins combine rows from two table references on a matching condition; set operators combine the *results* of two queries with the same shape. Spark SQL's SQL-level syntax reads like any relational database, but the plan it compiles to is distributed - matching rows have to physically land on the same machine before they can be compared, which is not something a single-process database ever has to think about.

## Why it exists

Silver tables are narrow and split by source; gold is where facts meet dimensions and different sources get reconciled. Joins and unions are the mechanism for that reconciliation, and the physical strategy chosen for each - shuffle, broadcast, or something else - is usually the single biggest lever on a slow query's runtime.

## How it works

**Join types.** `INNER` (the default), `LEFT OUTER`, `RIGHT OUTER`, `FULL OUTER`, `CROSS`, plus two that Postgres has no dedicated keyword for: `LEFT SEMI`, which returns left rows that have a match without duplicating or pulling in right-side columns, and `LEFT ANTI`, which returns left rows with **no** match. Postgres users get the same result with `WHERE EXISTS (...)` and `WHERE NOT EXISTS (...)` subqueries; Spark SQL just names them.

**USING vs ON.** `JOIN customers USING (customer_id)` matches on the named column and folds it into a single output column. `JOIN customers ON orders.customer_id = customers.customer_id` keeps both columns in the result, which then need an alias or a `DROP` if you `SELECT *`. `NATURAL JOIN` infers the key from shared column names and is worth avoiding: a later `ALTER TABLE ADD COLUMN` on either side can silently change what it matches on.

**Join hints.** `/*+ BROADCAST(alias) */` forces one side to be copied in full to every executor, skipping the shuffle for that side entirely - the right call when one table is small. `/*+ MERGE(alias) */` forces a shuffle sort-merge join, `/*+ SHUFFLE_HASH(alias) */` a shuffle hash join, and `/*+ SHUFFLE_REPLICATE_NL(alias) */` a replicated nested-loop join for non-equi conditions. When hints conflict, Databricks picks in the order broadcast, merge, shuffle hash, replicate nested loop.

**UNION vs UNION ALL.** `UNION ALL` concatenates result sets as-is - cheap, no coordination beyond matching column counts and types. `UNION` (equivalently `UNION DISTINCT`) removes duplicates across the *combined* result, which means comparing every row against every other row - a full shuffle, easy to reach for out of habit when `UNION ALL` was what was actually meant.

**INTERSECT and EXCEPT.** `INTERSECT` keeps rows present in both queries; `EXCEPT` (or `MINUS`) keeps rows from the first query absent from the second. Both default to removing duplicates first (`DISTINCT`); the `ALL` variants preserve multiplicity instead. Like `UNION`, both require shuffling data to compare rows across the cluster.

**Why the shuffle matters here and not on a single machine.** A join or a distinct-based set operation needs rows with the same key to end up being compared. On Postgres that happens in one process against data (and indexes) already sitting in shared memory or on local disk. On Databricks, the same comparison first requires moving rows across the network so matching keys land on the same executor - unless one side is small enough to broadcast instead. That network shuffle, and the skew it can expose when one key is far more common than the others, is the real cost center; the SQL syntax hides it completely.

| | Databricks (Spark SQL) | Postgres |
|---|---|---|
| "Rows with a match, left columns only" | `LEFT SEMI JOIN` | `WHERE EXISTS (...)` |
| "Rows with no match" | `LEFT ANTI JOIN` | `WHERE NOT EXISTS (...)` |
| Avoiding data movement | join hints (`BROADCAST`, ...) | driven by planner + indexes, no explicit hint syntax |
| Physical join cost | shuffle across executors (or broadcast) | in-process, index-assisted |
| Cheapest way to combine two queries | `UNION ALL` | `UNION ALL` |

## Example

```sql
-- customers who placed no order in the period: LEFT ANTI, not NOT IN
SELECT c.customer_id, c.email
FROM shop.silver.customers c
LEFT ANTI JOIN shop.silver.orders o
  ON c.customer_id = o.customer_id AND o.order_date >= DATE'2026-01-01';

-- small dimension forced to broadcast, large fact left alone
SELECT /*+ BROADCAST(p) */ o.order_id, p.category
FROM shop.silver.orders o
JOIN shop.silver.products p USING (product_id);

SELECT customer_id FROM shop.silver.orders_eu
UNION ALL
SELECT customer_id FROM shop.silver.orders_us;

SELECT customer_id FROM shop.silver.customers_2025
EXCEPT
SELECT customer_id FROM shop.silver.customers_2026;
```

```python
orders = spark.table("shop.silver.orders")
customers = spark.table("shop.silver.customers")

no_orders = customers.join(orders, on="customer_id", how="left_anti")
```

## Common mistakes

- Emulating `LEFT ANTI JOIN` with `WHERE customer_id NOT IN (SELECT ...)` where the subquery can return `NULL` - the whole `NOT IN` silently matches nothing. `LEFT ANTI JOIN` or `NOT EXISTS` don't have this trap.
- Reaching for `UNION` out of habit when `UNION ALL` was intended, then paying for a full shuffle-based dedup on tables where duplicates were never possible.
- Joining `ON` two differently-named key columns and then calling `SELECT *`, leaving both columns in the result with no clear owner.
- Forcing `/*+ BROADCAST(t) */` on a table that quietly grew past executor memory - it worked in development and fails months later in production.
- Writing a comma-separated `FROM a, b` without a join predicate: Spark accepts the resulting cross join without complaint.

> [!tip]
> Reach for `LEFT SEMI` and `LEFT ANTI` instead of `IN` / `NOT IN` subqueries - they read clearer and don't have the `NULL` trap that silently empties a `NOT IN` result.
