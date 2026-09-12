---
id: sql-editor-basics
title: The SQL editor
area: sql-editor
level: beginner
summary: The SQL editor runs ad-hoc queries against a warehouse, with saved queries, parameters, snippets, and scheduled refreshes.
prerequisites: [platform-architecture, unity-catalog-overview]
related: [dataframe-columns-rows, git-folders, query-profile, dashboards-overview]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/sql/user/sql-editor/
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/sql/user/sql-editor/parameter-widgets
    checked: 2026-09-10
aliases: [sql editor, query editor, saved query, parameter widget, dbsql editor]
updated: 2026-09-10
status: published
---

## What it is

The **SQL editor** is the workspace's dedicated place to write and run SQL against a warehouse: one statement or several, with results, a query history, and everything needed to save and share a query — no notebook cells, no other language.

## Why it exists

Not every workflow needs a notebook's mix of languages and cell-by-cell execution. An analyst who thinks in SQL and wants to explore a table, save a query, and share it with a teammate benefits from an interface built entirely around that: a single statement box, a results grid, and one-click visualization, with SQL-specific conveniences a notebook doesn't offer, like parameter widgets and query-level sharing permissions.

## How it works

### Running queries

Every query runs against a chosen SQL warehouse (see [[sql-warehouse-sizing]]); you can run the whole statement or just the one under the cursor in a multi-statement script, and results come back as a table you can chart, filter, or download directly.

### Saved queries and folders

A query can be saved and organized into folders in the workspace browser alongside notebooks and other objects, and reopened later, edited collaboratively, or reviewed through its version history.

### Parameters

Prefixing a name with a colon — `:region` — turns it into a **parameter widget**: the editor renders an input control (text, dropdown, date, or a dropdown driven by another query) so a value can change without touching the SQL. Each widget has a configurable type, title, and default, set from a gear icon next to it.

### Snippets

Frequently reused fragments of SQL can be saved once and inserted into new queries, avoiding copy-pasted boilerplate across similar queries.

### Scheduling a refresh

A saved query can be scheduled to re-run automatically; that scheduled result is what an alert (see [[alerts-overview]]) or a subscribed dashboard dataset (see [[dashboards-overview]]) actually reads.

### Sharing and permissions

A query has its own permission levels — from viewing results to running, editing, or fully managing it — separate from table-level Unity Catalog grants. Its execution mode matters too: **run as viewer** applies the person running it own credentials, while **run as owner** always uses the owner's credentials, which is how legacy alerts and some jobs keep working even after the original author changes teams.

### SQL editor vs. notebook

| | SQL editor | Notebook |
| --- | --- | --- |
| Language | SQL only | Python, SQL, Scala, R mixed |
| Unit of work | one query, multi-statement scripts | cells, run in any order |
| Best for | ad-hoc analysis, dashboards, alerts | pipelines, multi-step logic, orchestration |
| Sharing model | per-query permissions | notebook/workspace permissions |

## Example

A saved query with a parameter widget instead of a hardcoded value:

```sql
SELECT customer_id, order_date, amount
FROM sales.gold.orders
WHERE region = :region
  AND order_date >= :start_date;
```

## Common mistakes

- Writing a multi-step transformation as one long saved query instead of a proper job or pipeline that gets retries and dependencies.
- Hardcoding a value that changes often (a region, a date) instead of exposing it as a parameter widget, and ending up with several near-duplicate queries.
- Not noticing a query is set to **run as owner**, so it keeps running under someone else's identity long after they've moved teams.
- Treating a query's schedule as a substitute for a job schedule — it refreshes a result, it doesn't orchestrate dependencies or retries.
- Expecting notebook features (multiple languages, cell state) inside the SQL editor.

> [!tip]
> If a saved query is starting to need branching logic or has to wait on another pipeline, that's the signal to move it into a job or pipeline instead of stretching the SQL editor to do orchestration.
