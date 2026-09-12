---
id: sql-parameters-and-variables
title: Query parameters and session variables
area: sql-editor
level: intermediate
summary: "Named parameter markers (:name) and the widgets they raise in the editor, notebooks, dashboards and Genie, the IDENTIFIER clause for dynamic names, session variables, and migrating off mustache."
prerequisites: [sql-editor-basics, spark-sql-basics]
related: [dashboards-overview, genie-agents, notebooks-basics, sql-scripting, dashboard-data-modeling]
exams:
  - cert: data-analyst-associate
    domain: "Working with Dashboards and Visualizations in Databricks"
    objective: "Work with parameters in SQL queries and dashboards, including defining, configuring, and testing parameters."
sources:
  - url: https://docs.databricks.com/aws/en/sql/user/queries/query-parameters
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/user/sql-editor/parameter-widgets
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/user/sql-editor/mustache-parameters
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-parameter-marker
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-names-identifier-clause
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-variables
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/dashboards/manage/filters/parameters
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/notebooks/widgets
    checked: 2026-09-12
aliases: [query parameters, named parameter markers, parameter widgets, mustache, curly braces, IDENTIFIER clause, session variables, DECLARE VARIABLE, SET VAR, dashboard parameters, dynamic dropdown]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

A **named parameter marker** is a colon followed by a name, written where a value would go: `WHERE fare_amount < :fare_parameter`. It is a typed placeholder, not text substitution. The value is supplied when the statement runs, by the widget the surface renders, by the Statement Execution API, or by the `args` argument of `spark.sql()`.

The same `:name` syntax works in the SQL editor (new and legacy, see [[sql-editor-basics]]), notebooks, the AI/BI dashboard dataset editor, and Genie Agents. What differs between them is the widget: what types you can pick, what controls the reader gets, and how a multi-value selection reaches the query.

**Session variables** are the other half of this page and a different mechanism. They are typed objects that live in the session rather than in one statement, declared and assigned from SQL itself with no API involved.

## Why it exists

The legacy SQL editor used **mustache** syntax: `{{region}}`, substituted as text into the query before it ran. Text substitution has the two problems text substitution always has. A value could close a quote and append its own SQL, and you had to remember which parameters needed quoting in the query and which did not, so half the migration table in the docs is about quotes.

Parameter markers keep the value and the structure of the statement separate, which makes SQL injection a non-issue and the type explicit. That is also why they are the only syntax the new SQL editor accepts: a query with `{{ }}` has to be converted before it will run there, or in a notebook, a dashboard dataset, or a Genie Agent (see [[genie-agents]]).

## How it works

### Parameter types and widget types

In the SQL editor, the **parameter type** decides how the value is interpreted and the **widget type** decides how somebody picks it. Any parameter type can use any widget type.

| Parameter type | Notes |
| --- | --- |
| String | free text. Backslashes and quotes are escaped, and the value is quoted for you |
| Integer | whole numbers |
| Decimal | fractional numbers |
| Date | calendar picker, defaults to today |
| Timestamp | calendar picker with a time, defaults to now |

| Widget type | What the reader gets |
| --- | --- |
| Text input | a free-form box, no suggestions |
| Dropdown | a fixed list, nothing else allowed |
| Combobox | a fixed list plus the option to type something else |
| Multiselect | several values from a fixed list, delivered as one comma-separated string to split |
| Dynamic dropdown | choices from a saved query, refreshed as the data changes. SQL editor only, and it shows at most 1,024 values |
| Date and Timestamp range | one control producing two parameters, `:name.min` and `:name.max` |

Dashboards (see [[dashboards-overview]]) expose a shorter list of types: String, Date, Date and Time, and Numeric, where Numeric splits into Decimal (the default) and Integer. A dashboard parameter set to allow multiple selections is inserted into the query as an array and has to be consumed with `array_contains`, which is where it differs from the editor's multiselect: same function, but no `split` in front of it.

In a notebook (see [[notebooks-basics]]), the widget is created with `dbutils.widgets` or the SQL form `CREATE WIDGET DROPDOWN state DEFAULT "CA" CHOICES SELECT ...`, and read back from SQL as `:state`.

### IDENTIFIER, for anything that is a name

A marker stands in for a value. It cannot stand in for a table, column, schema, catalog or function name, because those are identifiers and the parser needs to know them before it knows any values. The **IDENTIFIER clause** is the bridge, and it is the answer to "how do I parameterise the table name":

```sql
SELECT * FROM IDENTIFIER(:catalog || '.' || :schema || '.' || :table);
SELECT * FROM samples.tpch.orders WHERE IDENTIFIER(:field_param) < 10000;
```

It needs Databricks Runtime 13.3 LTS or above, accepts string literals, markers and session variables, and is allowed in a fixed set of places: the subject of `CREATE`, `ALTER`, `DROP` or `UNDROP` for a table, view or function; the target of `INSERT`, `UPDATE`, `DELETE`, `MERGE` or `COPY INTO`; the target of `SHOW` or `DESCRIBE`; `USE`; a function invocation; and any table, view or column referenced in a query. From Databricks Runtime 18.0 the arguments can sit next to each other without `||` (`IDENTIFIER(:schema '.' :table)`), and the older concatenated-expression form is deprecated.

Two version-dependent limits are worth holding on to. Up to and including Databricks Runtime 17.3 LTS, a marker cannot appear in a DDL statement at all except through `IDENTIFIER`, so parameterising something like a `LOCATION` string meant building the statement with `EXECUTE IMMEDIATE` (see [[sql-scripting]]). From Databricks Runtime 18.0 a marker is accepted anywhere a literal of its type is accepted, which covers generated columns, `DEFAULT` expressions, view bodies, SQL functions and `LOCATION`.

### Session variables

`DECLARE OR REPLACE VARIABLE` creates a typed object in the `system.session` schema, private to your session and dropped when it ends. Databricks Runtime 14.1 and above.

```sql
DECLARE OR REPLACE VARIABLE run_date DATE DEFAULT current_date() - 1;
SET VAR run_date = '2026-09-01';
SELECT * FROM main.silver.orders WHERE order_date = run_date;
```

Three differences from markers decide which one you want. A marker exists for a single statement and its value comes from outside SQL; a variable survives across statements and is set from SQL. A variable can be referenced in the body of a temporary view or temporary SQL function, and the current value is used each time that object is read. And a variable shares a namespace with column names and aliases, where it resolves **last**, so a column called `run_date` wins and you have to write `session.run_date` to mean the variable.

Variables cannot be referenced in a check constraint, a generated column, a default expression, or the body of a persisted view or SQL UDF.

### Migrating off mustache

Mustache only works in the legacy SQL editor. The conversions that catch people:

| Old | New |
| --- | --- |
| `WHERE date_field < '{{date_param}}'` | `WHERE date_field < :date_param` (no quotes) |
| `SELECT * FROM {{table_name}}` | `SELECT * FROM IDENTIFIER(:table)`, with the full three-level name |
| `{{range.start}}` and `{{range.end}}` | `:range.min` and `:range.max` |
| `"({{area_code}}) {{phone_number}}"` | `format_string("(%d) %d", :area_code, :phone_number)` |
| `SELECT INTERVAL {{p}} MINUTE` | `SELECT CAST(:param AS INTERVAL MINUTE)` |

The quotes are the trap. Mustache pasted text in, so you wrote the quotes yourself; a marker is already typed, so leaving them in compares your column against the literal string `:date_param`, or fails outright.

## Example: one saved query, three widgets

```sql
SELECT
  date_trunc(:grain, o.order_date) AS bucket,
  o.channel,
  count(*)      AS orders,
  sum(o.amount) AS revenue
FROM main.silver.orders o
WHERE o.order_date BETWEEN :window.min AND :window.max
  -- A multiselect arrives as one comma-separated string.
  AND array_contains(transform(split(:channels, ','), s -> trim(s)), o.channel)
GROUP BY 1, 2
ORDER BY bucket DESC;
```

`:grain` is a dropdown of `DAY`, `MONTH`, `YEAR` fed straight into `date_trunc`. `:window` is a Date range widget, which is why the query refers to `:window.min` and `:window.max` without either being declared separately. `:channels` is a multiselect: the selected values arrive as a single comma-separated string, so the query splits it, trims each element, and tests membership. That `transform`/`split`/`array_contains` shape is the documented pattern, and it is written for strings; a numeric list needs a `CAST` inside the `transform`.

## Common mistakes

- **Quoting a named parameter.** `WHERE region = ':region'` compares against a literal. Mustache needed the quotes, markers never do.
- **Trying to parameterise a table or column name directly.** `FROM :table` does not parse. Wrap it in `IDENTIFIER`, and use the full three-level name.
- **Using a dynamic date value on a scheduled query.** The lightning-bolt values (today, last week, last month) are not compatible with scheduling, so the schedule runs with something you did not intend.
- **Assuming a multiselect arrives as an array.** It arrives as one string. Without the `split` and `array_contains` pattern the filter matches nothing, silently.
- **Mixing `:named` and `?` markers in one statement.** Databricks rejects the statement; a marker set must be entirely one or the other.
- **Letting a session variable collide with a column name.** Variables resolve last, so the column wins and the query quietly filters on itself. Qualify with `session.`, or name variables so they cannot clash.
- **Expecting a dynamic dropdown to list everything.** It stops at 1,024 values, and the ones past that are not shown or flagged.

> [!exam]
> The Data Analyst Associate guide asks you to define, configure and test parameters in queries and dashboards. Know the syntax is a colon and the name (`:region`), with no quotes and no curly braces; that a table or column name needs `IDENTIFIER(:param)`; that a Date or Timestamp range widget produces `.min` and `.max`; and the widget list: Text input, Dropdown, Combobox, Multiselect, Dynamic dropdown and range. The distinction that catches people is mustache versus markers: `{{ }}` is the legacy SQL editor only, and a mustache query pasted into a notebook, a dashboard dataset or a Genie Agent has to be converted before it runs.
