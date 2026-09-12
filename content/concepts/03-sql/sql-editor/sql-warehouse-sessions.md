---
id: sql-warehouse-sessions
title: SQL warehouse sessions
area: sql-editor
level: intermediate
summary: A session keeps variables, temporary views and tables, the current catalog and schema and session settings across statements, and it belongs to the query object and the warehouse rather than to you.
prerequisites: [sql-editor-basics]
related:
  [
    sql-editor-basics,
    notebooks-basics,
    spark-sql-basics,
    sql-query-caching,
    sql-warehouse-types-and-channels,
  ]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/sql/user/queries/sessions
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/tables/temporary-tables
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-variables
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-ddl-declare-variable
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-parameters
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/user/queries/query-tags
    checked: 2026-09-12
aliases:
  [
    session,
    session state,
    temporary view,
    temp table,
    declare variable,
    use catalog,
    query tags,
    session configuration,
  ]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

A **session** is the state a SQL warehouse keeps for you between statements. It is created the first time you run a query on a warehouse, and from then on the statements you run share variables, temporary views, temporary tables, the current catalog and schema, and any session configuration you have set.

The part that surprises people is what a session is keyed on. It is not your user. It is the pair of **the query object and the warehouse it is attached to**: a saved query, a notebook, or a workspace `.sql` file, plus one specific warehouse.

## Why it exists

SQL as a language assumes state. `DECLARE VARIABLE`, `CREATE TEMPORARY VIEW`, `USE CATALOG` and `SET` all mean nothing if each statement starts from nothing. Without a session, a five-step script only works if you run all five steps in one go, which is exactly what you do not want while you are still writing step three.

So people worked around it. They ran the whole script on every iteration, or they materialised the intermediate result into a real table in a real schema, which meant asking for `CREATE TABLE` on something and then remembering to clean it up. A session removes both workarounds: you run one statement, look at the answer, and write the next one against it.

## How it works

### What the session carries

| State                 | Created with                                            | Notes                                                                          |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Variables             | `DECLARE VARIABLE`, set with `SET VAR`                  | live in the `system.session` schema, dropped implicitly when the session ends  |
| Temporary views       | `CREATE TEMPORARY VIEW`                                 | share a namespace with temporary tables                                        |
| Temporary tables      | `CREATE TEMPORARY TABLE`                                | Databricks SQL, and Databricks Runtime 18.1 and above                          |
| Environment           | `USE CATALOG`, `USE SCHEMA`                             | the current catalog and schema for unqualified names                           |
| Session configuration | `SET`, undone with `RESET`                              | `TIMEZONE`, `ANSI_MODE`, `STATEMENT_TIMEOUT`, `USE_CACHED_RESULT` and the rest |
| Query tags            | `SET QUERY_TAGS`, or the `query_tags` session parameter | in Public Preview as of September 2026                                         |

Configuration parameters have three scopes: a system default, a global value an administrator sets for every new session, and a session value you set with `SET`. `RESET <parameter>` puts one back to the global default; bare `RESET` puts all of them back. `STATEMENT_TIMEOUT`, for example, has a system default of 172800 seconds and is settable at both the global and session level.

### How long it lives

A session stays alive as long as a command runs at least once every **eight hours**, and **expires after eight hours of inactivity**. It **survives the warehouse stopping or restarting**, which is worth stating plainly: a serverless warehouse with a ten-minute auto-stop will sleep several times during your afternoon without costing you your temporary views.

Temporary tables have a second, harder ceiling. They exist only within the session that created them, and their maximum lifetime is **seven days from session creation**. They become inaccessible when the session ends or at seven days, whichever comes first, and Databricks reclaims the storage in the background afterwards, typically within a few days. The same limits apply in notebooks, the SQL editor, jobs and JDBC or ODBC sessions.

### The sharing behaviour that catches people out

Because the session belongs to the query object and the warehouse, **everyone with access to that object on that warehouse shares the same session**. If user A creates a temporary view in a saved query on warehouse X, user B can open the same saved query on warehouse X and select from that view. Neither of them did anything unusual.

That cuts both ways. A `SET TIMEZONE` one person runs to check something applies to the next person's results in that query. A `SET use_cached_result = false` left behind in a session makes a colleague's benchmark look bad. A `DROP TEMP TABLE` removes state somebody else is mid-way through using.

The isolation boundary is the session, not the user, and the documentation on temporary tables says exactly that: session-level isolation, where no other user can read or even detect your temporary tables. It is true, and it is not the same as privacy, because the session itself can be shared. If you want private state, use your own copy of the query or your own notebook.

Reattaching a query to a **different** warehouse creates a **new session with its own isolated state**, which is the cheapest way to get a clean slate and also the most common way to lose work you had built up.

### Name resolution, and shadowing

Reference a temporary table by name alone, with no catalog or schema. For an unqualified name, Databricks looks in this order:

1. temporary tables in the current session,
2. permanent tables in the current schema.

So a temporary table called `customers` shadows `main.gold.customers` for the whole session, silently. Use the three-level name when you mean the permanent one. Any user can create a temporary table without holding `CREATE TABLE` on any catalog or schema, and temporary tables and temporary views share one namespace, so you cannot have both named the same thing.

### What temporary tables cannot do

They accept `INSERT`, `UPDATE` and `MERGE INTO`, but not `DELETE FROM`. `ALTER TABLE` is unsupported, so a schema change means replacing the table. No cloning, no time travel, no streaming (they cannot be used inside `foreachBatch`), and SQL APIs only, not the DataFrame API. Do not add a `USING` clause: they are Delta by default and naming a format is an error.

## Example: building a script one statement at a time

Each statement below is run on its own, in order, and the ones after the first rely on state the earlier ones left behind:

```sql
USE CATALOG main;
USE SCHEMA gold;

DECLARE OR REPLACE VARIABLE cutoff DATE;
SET VAR cutoff = current_date() - INTERVAL 30 DAYS;

CREATE OR REPLACE TEMP TABLE recent_orders AS
SELECT order_id, customer_id, order_date, amount
FROM orders              -- resolves through the session's current catalog and schema
WHERE order_date >= cutoff;

SELECT customer_id, SUM(amount) AS total
FROM recent_orders
GROUP BY customer_id
ORDER BY total DESC
LIMIT 20;
```

When you are done, clean up rather than waiting eight hours, because the next person to open this query on this warehouse inherits whatever you leave:

```sql
DROP TEMP TABLE IF EXISTS recent_orders;
DROP TEMPORARY VARIABLE IF EXISTS cutoff;
RESET;
```

## Common mistakes

- **Assuming a temporary view is private.** It belongs to the session, and the session belongs to the query object plus the warehouse. A colleague opening the same saved query on the same warehouse is in your session.
- **Building a scheduled job on a temporary table.** It disappears when the session ends, or seven days after the session started, whichever comes first. Anything a job depends on tomorrow belongs in a real Unity Catalog table.
- **Switching the query to another warehouse mid-flow.** That is a new session with empty state, and there is no way to move the old one across.
- **Leaving a session parameter set after a one-off test.** `SET ANSI_MODE = false` or `SET use_cached_result = false` outlives your statement and applies to everyone else in that session. `RESET` the parameter, not just your mind.
- **Naming a temporary table after a permanent one.** Unqualified names resolve to the session's temporary table first, so the report keeps running and quietly reads the wrong data.
- **Expecting `ALTER TABLE`, `DELETE FROM` or time travel on a temporary table.** None are supported. Replace the table instead.

> [!tip]
> Before you debug "my temporary view has vanished", check two things in order: whether more than eight hours have passed since the last statement, and whether the query is still attached to the same warehouse. Those account for almost every disappearance, and neither of them is the warehouse having restarted, because a session survives that.
