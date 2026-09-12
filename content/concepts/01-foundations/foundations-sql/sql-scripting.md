---
id: sql-scripting
title: SQL scripting and stored procedures
area: foundations-sql
level: advanced
summary: "BEGIN ... END compound blocks with local variables, loops, EXECUTE IMMEDIATE, condition handlers and cursors, and how to persist a working script as a Unity Catalog procedure."
prerequisites: [spark-sql-basics, sql-merge-and-dml]
related: [sql-parameters-and-variables, jobs-control-flow, udfs-and-alternatives, python-in-notebooks]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-scripting
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/control-flow/compound-stmt
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-ddl-create-procedure
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-aux-call
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-aux-execute-immediate
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/control-flow/for-stmt
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/control-flow/fetch-stmt
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/control-flow/get-diagnostics-stmt
    checked: 2026-09-12
aliases: [sql scripting, stored procedure, CREATE PROCEDURE, CALL, BEGIN END, compound statement, condition handler, cursor, SQL/PSM, procedural sql]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

SQL scripting is the procedural half of Databricks SQL. Everything lives inside a **compound statement**: a `BEGIN ... END` block that first declares local variables, conditions, cursors and error handlers, then runs a sequence of queries, DML, DDL, `GRANT`, loops, conditionals, `SET`, `EXECUTE IMMEDIATE` and nested blocks. The grammar follows the SQL/PSM standard, so it reads like PL/pgSQL or T-SQL rather than like anything else on the platform.

A script is not a stored object. It is one statement you submit, the same way you submit a `SELECT`. Once you have one that works, `CREATE PROCEDURE` persists it in Unity Catalog and `CALL` runs it. In a notebook, a compound statement has to be the only statement in its cell.

## Why it exists

Before this, conditional SQL meant leaving SQL: a Python notebook with `spark.sql()` calls inside an `if`, or a Lakeflow job with an If/else task (see [[jobs-control-flow]]). Both work, and both drag a second language and a second tool into a warehouse-only workload just to express "reload only if yesterday's count looks wrong".

The other driver is migration. Teams arriving from Oracle, SQL Server or Teradata bring thousands of lines of procedural SQL with them; rewriting it as declarative pipelines is a project, running it as a script is an afternoon. Procedures also carry their own privilege, so an analyst can run a routine without being granted anything on the tables underneath.

## How it works

### The compound block

```sql
BEGIN
  DECLARE merged BIGINT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
    SELECT 'silver load failed' AS status;

  MERGE INTO main.silver.orders t
  USING main.bronze.orders_raw s ON t.order_id = s.order_id
  WHEN MATCHED THEN UPDATE SET *
  WHEN NOT MATCHED THEN INSERT *;

  GET DIAGNOSTICS merged = ROW_COUNT;
  SELECT merged AS merged_rows;
END;
```

The declaration order is fixed: variables and conditions, then cursors, then handlers, then statements. A nested `BEGIN ... END` opens a new scope, names resolve innermost first, and an optional label (`outer: BEGIN ... END outer`) disambiguates a shadowed name. A `SELECT` anywhere in the block returns a result set to whoever ran the script.

### What each piece needs

Requirements differ piece by piece, and a script written against one runtime fails to parse on an older one.

| Piece | Requirement |
| --- | --- |
| `BEGIN ... END`, `IF`, `CASE`, `WHILE`, `LOOP`, `REPEAT`, `FOR`, `LEAVE`, `ITERATE`, `SIGNAL`, `RESIGNAL`, `GET DIAGNOSTICS` | Databricks SQL, or Databricks Runtime 16.3 and above |
| Session variables (`DECLARE VARIABLE`, `SET VAR`) | Databricks SQL, or Databricks Runtime 14.1 and above |
| `EXECUTE IMMEDIATE` | Databricks SQL, or Databricks Runtime 14.3 and above. A statement string that is not a literal or a variable, and nested `EXECUTE IMMEDIATE`, need 17.3 |
| More than one variable in a single `DECLARE` | Databricks Runtime 17.2 and above |
| `EXIT` condition handlers | Databricks SQL, or Databricks Runtime 16.3 and above |
| `CONTINUE` condition handlers | Databricks Runtime 18.1 and above |
| Cursors: `DECLARE ... CURSOR`, `OPEN`, `FETCH`, `CLOSE` | Databricks Runtime 18.1 and above |
| `BEGIN ATOMIC` (Public Preview) | Databricks SQL, or Databricks Runtime 17.0 and above. Multi-table transactions need 18.0 and catalog commits on every table |
| `CREATE PROCEDURE`, `CALL` | Databricks SQL, or Databricks Runtime 17.0 and above, Unity Catalog only |

Calling a procedure over the Databricks ODBC driver needs driver version 2.11 or above.

### Variables, local and session

A **local variable** is declared inside a block and dies with it. A **session variable**, declared outside any block with `DECLARE OR REPLACE VARIABLE`, lives in `system.session` until the session ends; [[sql-parameters-and-variables]] covers those in their own right. The assignment keyword differs: inside a block you write `SET name = ...`, outside one `SET VAR name = ...`, because bare `SET` is the configuration statement. `SET` also takes a query, so `SET (lo, hi) = (SELECT min(d), max(d) FROM t)` fills both at once.

### Control flow, and the loop you probably do not want

`IF ... THEN ... ELSEIF ... ELSE ... END IF` and `CASE` branch. `WHILE`, `REPEAT ... UNTIL` and bare `LOOP` iterate, with `LEAVE label` to break out and `ITERATE label` to skip ahead. `FOR row AS <query> DO ... END FOR` walks a result set, and it is the construct people reach for first. The reference is blunt about it: a `FOR` loop can usually be rewritten as a relational query, and the relational query is typically more efficient.

### Dynamic SQL

`EXECUTE IMMEDIATE` runs a statement held in a string, binds parameter markers with `USING`, and assigns a single-row result to variables with `INTO`.

```sql
BEGIN
  DECLARE target STRING DEFAULT 'main.silver.orders';
  DECLARE n BIGINT;
  EXECUTE IMMEDIATE 'SELECT count(*) FROM IDENTIFIER(:t) WHERE order_date = :d'
    INTO n USING target AS t, current_date() - 1 AS d;
  SELECT n AS rows_yesterday;
END;
```

Markers in the string must be all named (`:d`) or all positional (`?`), never both. `INTO` on something that is not a query raises `INVALID_STATEMENT_FOR_EXECUTE_INTO`, and a query returning more than one row raises `ROW_SUBQUERY_TOO_MANY_ROWS`.

### Handling errors

`DECLARE { EXIT | CONTINUE } HANDLER FOR <conditions> <statement>` intercepts a condition. `EXIT` runs the handler and then leaves the block that declared it, implicitly closing any cursors that block opened; `CONTINUE` runs the handler and resumes at the statement after the one that failed. Conditions can be a Databricks error class by name (`DIVIDE_BY_ZERO`), an explicit `SQLSTATE`, a condition you declared yourself, the catch-all `SQLEXCEPTION`, or `NOT FOUND` for the `02xxx` class. The most specific applicable handler wins, and a handler never catches an error raised inside its own body.

`GET DIAGNOSTICS CONDITION 1 msg = MESSAGE_TEXT, state = RETURNED_SQLSTATE` tells you what happened, and it has to be the handler's first statement. `SIGNAL` raises a condition of your own; inside a handler use `RESIGNAL`, which preserves the diagnostic stack that `SIGNAL` clears.

### Cursors

From Databricks Runtime 18.1, `DECLARE c CURSOR FOR <query>` plus `OPEN`, `FETCH ... INTO` and `CLOSE` reads a result set row by row, and the query does not run until `OPEN`. Fetching past the last row raises `CURSOR_NO_MORE_ROWS` (SQLSTATE `02000`), a completion condition rather than an exception, so the standard shape is a `CONTINUE HANDLER FOR NOT FOUND` that flips a `done` flag. One `STRUCT` variable can receive every column at once.

### Persisting a script as a procedure

`CREATE PROCEDURE name(...) LANGUAGE SQL SQL SECURITY { INVOKER | DEFINER } AS <compound statement>` stores the block in Unity Catalog. `LANGUAGE SQL` and one of the two security clauses are mandatory; `COMMENT`, `NOT DETERMINISTIC`, `MODIFIES SQL DATA` and `DEFAULT COLLATION` are optional. Parameters are `IN` (the default), `OUT` or `INOUT`, and an `OUT` or `INOUT` argument at the call site must be a variable. Creation validates syntax only, so the body resolves on the first `CALL`.

`SQL SECURITY DEFINER` is the clause worth understanding. The body runs with the owner's privileges, and with the current catalog, current schema and SQL configuration frozen as they were at creation time, so a caller needs `EXECUTE` on the procedure and nothing at all on the tables it touches (see [[privileges-grant-revoke]]). `INVOKER` runs the body as the caller and resolves names against the caller's current catalog and schema.

### When a Python notebook is the better tool

Four honest limits:

- A `FOR` loop over rows is slower than the set-based query it replaces, by the documentation's own admission.
- Cursors are documented for Databricks Runtime 18.1 and above, not for Databricks SQL, so a warehouse-only team has none.
- `BEGIN ATOMIC` forbids `DECLARE ... HANDLER`, so within one block you choose between automatic rollback and catching the error.
- The whole block is a single statement, alone in its notebook cell, so there is no stepping through it and no inspecting a variable halfway. Python gives you a cell boundary wherever you want one, and [[python-in-notebooks]] is where anything genuinely iterative belongs.

## Example: a guarded nightly promotion

A procedure that refuses to promote yesterday's batch if it is suspiciously small, records the outcome either way, and returns a status row.

```sql
CREATE OR REPLACE PROCEDURE main.ops.promote_orders(IN run_date DATE, OUT promoted BIGINT)
  LANGUAGE SQL
  SQL SECURITY DEFINER
  MODIFIES SQL DATA
  COMMENT 'Promote one day of bronze orders to silver, with a volume guard'
  AS BEGIN
    DECLARE incoming BIGINT DEFAULT 0;
    DECLARE baseline DOUBLE DEFAULT 0;
    DECLARE err STRING;
    DECLARE low_volume CONDITION FOR SQLSTATE '45001';

    -- EXIT: log the failure, then leave the block. Nothing downstream runs.
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    logged: BEGIN
      GET DIAGNOSTICS CONDITION 1 err = MESSAGE_TEXT;
      INSERT INTO main.ops.promotion_log (load_date, rows_promoted, status, message, logged_at)
        VALUES (run_date, 0, 'failed', err, current_timestamp());
    END logged;

    SET incoming = (SELECT count(*) FROM main.bronze.orders_raw WHERE order_date = run_date);
    SET baseline = (SELECT avg(rows_promoted) FROM main.ops.promotion_log
                    WHERE status = 'ok' AND load_date >= run_date - INTERVAL 14 DAYS);

    -- Less than half the recent average is a data problem, not a quiet day.
    IF baseline > 0 AND incoming < baseline / 2 THEN
      SIGNAL low_volume SET MESSAGE_TEXT = 'volume guard tripped';
    END IF;

    MERGE INTO main.silver.orders t
    USING (SELECT * FROM main.bronze.orders_raw WHERE order_date = run_date) s
      ON t.order_id = s.order_id
    WHEN MATCHED THEN UPDATE SET *
    WHEN NOT MATCHED THEN INSERT *;

    GET DIAGNOSTICS promoted = ROW_COUNT;
    INSERT INTO main.ops.promotion_log (load_date, rows_promoted, status, message, logged_at)
      VALUES (run_date, promoted, 'ok', NULL, current_timestamp());
  END;
```

Running it, with a session variable to catch the `OUT` parameter:

```sql
DECLARE OR REPLACE VARIABLE moved BIGINT;
CALL main.ops.promote_orders(current_date() - 1, moved);
SELECT moved AS rows_promoted;
```

Three things make this schedulable rather than watchable. `SQL SECURITY DEFINER` means the caller needs `EXECUTE` on the procedure and no privilege at all on the three tables. The `EXIT` handler turns any failure, the guard included, into a logged row and stops before the `MERGE`, so a bad batch never reaches silver and `moved` comes back `NULL`. And the parameter names differ from the column names on purpose: columns beat parameters during name resolution, so a collision quietly changes what the predicate means.

## Common mistakes

- **Writing `SET VAR` inside a compound statement, or bare `SET` outside one.** The keyword is mandatory outside a block and forbidden inside it, and outside a block bare `SET` quietly sets a configuration parameter.
- **Putting a compound statement in a notebook cell alongside other SQL.** It has to be alone in the cell, and the parse error does not say so kindly.
- **Expecting `CREATE PROCEDURE` to catch a typo in a table name.** Creation checks syntax only; a misspelled table surfaces on the first `CALL`.
- **Reaching for `FOR` or a cursor because the logic feels sequential.** Write the set-based version first and measure. The loop is the fallback, not the starting point.
- **Treating `SQL SECURITY INVOKER` as the safe default.** Neither clause is a default and one is mandatory. `INVOKER` means every caller needs privileges on every table the body touches, which is usually the opposite of why you wrote the procedure.
