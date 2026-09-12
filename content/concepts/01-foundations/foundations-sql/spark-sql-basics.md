---
id: spark-sql-basics
title: Spark SQL, the dialect
area: foundations-sql
level: beginner
summary: How Spark SQL differs from a textbook SQL dialect - three-level namespace, ANSI mode on by default, and what a warehouse deliberately leaves out.
prerequisites: [platform-architecture, unity-catalog-overview]
related: [sql-data-types, sql-joins-and-sets, managed-vs-external-tables]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-qry-select
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-identifiers
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-ansi-compliance
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-ddl-usedb
    checked: 2026-09-10
aliases: [spark sql, three-level namespace, use catalog, use schema, ansi mode]
updated: 2026-09-10
status: published
---

## What it is

Spark SQL is the dialect you write everywhere on Databricks: in the SQL editor, inside a notebook cell, behind `spark.sql(...)` in PySpark, and inside a pipeline. It looks close enough to Postgres or MySQL that a query someone learned on `psql` will often just run - but it compiles to a distributed plan, not a single-process one, and it resolves tables through Unity Catalog's three-level namespace instead of a two-level `schema.table`. Those two facts explain most of the surprises beginners hit.

## Why it exists

A single SQL surface has to serve a notebook cell, a scheduled job, and a BI dashboard hitting a SQL warehouse, all against the same governed tables. That pushes two design choices: naming has to be unambiguous across catalogs shared by many teams ([[unity-catalog-overview]]), and correctness has to be checked strictly, because a silently wrong cast in a pipeline that runs unattended every night is worse than a query that fails loudly at parse time.

## How it works

**Three-level namespace.** Every table is `catalog.schema.table` (Postgres only has `schema.table`, with the database playing a role closer to Databricks' catalog but not switchable mid-session the same way). `USE CATALOG shop; USE SCHEMA silver;` sets the defaults for the session, after which `SELECT * FROM orders` resolves unambiguously. `current_catalog()` and `current_schema()` tell you where you actually are - worth checking before running anything destructive on a shared workspace.

**SELECT, WHERE, GROUP BY, ORDER BY.** These behave as expected, with a couple of extras: `GROUP BY ALL` groups by every non-aggregated column without listing them, and `HAVING` without a `GROUP BY` is legal and means "a global aggregate with a filter." `LIMIT` caps the rows returned, but without an `ORDER BY` it gives no guarantee about *which* rows you get - a distributed scan reads partitions in whatever order tasks finish, so `LIMIT 10` on an unsorted query can return a different sample on every run. In a single-node Postgres table people get away with assuming stable output; here you can't.

**Case sensitivity and backticks.** Identifiers are case-insensitive when referenced (`MyTable` and `mytable` are the same object), but string *data* comparisons are case-sensitive by default - the opposite of MySQL's common case-insensitive collation. Wrap an identifier in backticks when it contains spaces, dashes, or a reserved word: `` SELECT `order-id` FROM `my-table` ``.

**Looking around.** `DESCRIBE TABLE orders` shows columns and types; `DESCRIBE HISTORY orders` shows the Delta transaction log. `SHOW TABLES`, `SHOW SCHEMAS`, and `SHOW CATALOGS` list what's available, each accepting a `LIKE` pattern.

**ANSI mode is on by default** (Databricks SQL warehouses have always run this way; Databricks Runtime 17.0 / Spark 4.0 made it the default everywhere). An invalid `CAST('abc' AS INT)` raises an error instead of quietly returning `NULL`, and arithmetic overflow throws instead of wrapping. This is closer to Postgres' strictness than to MySQL's permissive defaults.

**What's missing.** No `CREATE SEQUENCE` - use `GENERATED ALWAYS AS IDENTITY` columns instead. No traditional B-tree, GIN, or hash indexes - performance instead comes from file-level statistics, Z-order, and [[liquid-clustering]]. Stored procedures and `CALL` only arrived recently, through DBSQL scripting, and are far less central than in Postgres. Declared `PRIMARY KEY` and `FOREIGN KEY` constraints exist but are informational only - Databricks never enforces them at write time.

| | Databricks (Spark SQL) | Postgres |
|---|---|---|
| Table address | `catalog.schema.table` | `schema.table` |
| `LIMIT` without `ORDER BY` | non-deterministic across a distributed scan | stable in practice on a single node |
| String equality | case-sensitive by default | case-insensitive with default collation in many setups |
| Indexes | none; file skipping, Z-order, liquid clustering | B-tree, GIN, hash, etc. |
| `PRIMARY KEY` / `FOREIGN KEY` | declared, not enforced | enforced |
| Auto-increment | `IDENTITY` column | `SERIAL` / sequence |

## Example

```sql
USE CATALOG shop;
USE SCHEMA silver;

SELECT channel, COUNT(*) AS orders, SUM(amount) AS revenue
FROM orders
WHERE order_date >= DATE'2026-01-01'
GROUP BY channel
HAVING SUM(amount) > 1000
ORDER BY revenue DESC
LIMIT 5;

DESCRIBE TABLE shop.silver.orders;
SHOW TABLES IN shop.silver LIKE 'order*';
```

```python
spark.sql("USE CATALOG shop")
spark.sql("USE SCHEMA silver")

df = (
    spark.table("orders")
    .filter("order_date >= DATE'2026-01-01'")
    .groupBy("channel")
    .sum("amount")
)
```

## Common mistakes

- Skipping `USE CATALOG` on a shared workspace and silently querying the wrong environment's `default` catalog.
- Trusting `LIMIT 10` to return "the same top rows" between runs without an `ORDER BY`.
- Expecting `CREATE SEQUENCE` or `nextval()` to exist - reach for an `IDENTITY` column.
- Treating a declared `FOREIGN KEY` as a safety net: nothing stops an orphaned row from being inserted.
- Assuming string comparisons are case-insensitive because that was the default on a previous MySQL project.

> [!tip]
> Start every session-based script with an explicit `USE CATALOG` / `USE SCHEMA`, and never rely on `LIMIT` for determinism - if you need "the top N", say so with `ORDER BY` first.
