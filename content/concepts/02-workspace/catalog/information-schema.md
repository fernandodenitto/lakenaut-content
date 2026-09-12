---
id: information-schema
title: The information schema
area: catalog
level: intermediate
summary: The SQL standard metadata views in every Unity Catalog catalog, filtered by what you are allowed to see, and the fastest way to answer questions about your own data estate.
prerequisites: [unity-catalog-overview]
related: [system-tables, privileges-grant-revoke, unity-catalog-lineage, managed-vs-external-tables]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-information-schema
    checked: 2026-09-12
aliases: [information_schema, INFORMATION_SCHEMA, metadata views, table_privileges, sql standard schema]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

`information_schema` is the SQL standard set of metadata views, and Unity Catalog gives you two of them.

Every catalog has its own `information_schema`, describing only the objects inside that catalog. The `system` catalog has one too, and that one spans every catalog in the metastore, with the exception of `hive_metastore`.

Both are ordinary views over metadata. You query them with `SELECT`, join them to each other, and put them in a dashboard. Nothing about them is Databricks-specific, which is the point: the same query shape works on any SQL engine that implements the standard.

## Why it exists

Catalog Explorer answers questions about one object at a time. That is fine until the question is about all of them at once. Which tables have no comment. Which columns look like they hold an email address. Who has `SELECT` on anything in the finance catalog. How many tables were created this quarter and by whom.

Those are one query each against `information_schema`, and they are hard to answer any other way short of a script that walks the API.

## How it works

### Two scopes, one shape

```sql
-- Everything in one catalog.
SELECT table_name, table_owner FROM main.information_schema.tables WHERE table_schema = 'silver';

-- Everything in the metastore, minus hive_metastore.
SELECT table_catalog, table_schema, table_name FROM system.information_schema.tables;
```

The column names are the same in both, so a query written against one usually moves to the other by changing the prefix.

### Permissions filter the rows, not the access

This is the behaviour that makes it usable and occasionally confusing. You do not need a grant to query `information_schema`: unlike the rest of the `system` catalog, it needs no explicit `SELECT`. What you get back is filtered to the objects you already have privileges on.

Two people running the same query therefore get different answers, and neither is wrong. If a table you know exists is missing from your results, the answer is nearly always that you cannot see it, not that it is gone.

### The views worth knowing

There are more than sixty. These are the ones that answer most questions:

| View | Answers |
| --- | --- |
| `tables` | what exists, who owns it, when it was created and last altered |
| `columns` | every column, its type, nullability and position |
| `table_privileges` | who was granted what, on which table, by whom |
| `views` | the definition text of a view |
| `routines` | functions and procedures registered in the catalog |
| `table_constraints` and `key_column_usage` | primary and foreign key declarations |
| `volumes` and `volume_privileges` | the same, for volumes |
| `catalog_tags`, `schema_tags`, `table_tags`, `column_tags` | tags, which is how you find classified or governed objects |

### Against the system catalog

They overlap in name only. `information_schema` describes **structure**: what objects exist and how they are shaped, right now. [[system-tables]] describe **behaviour** over time: what ran, what it cost, who read what, how long it took.

A useful rule: if the question has a verb in the past tense, it is a system table. If it is about what something is, it is the information schema. And the two join well, which is where the interesting queries live.

## Example: three questions, three queries

```sql
-- 1. Tables nobody documented, in the catalogs that matter.
SELECT table_catalog, table_schema, table_name, table_owner
FROM system.information_schema.tables
WHERE comment IS NULL
  AND table_catalog IN ('main', 'finance')
  AND table_schema <> 'information_schema'
ORDER BY table_catalog, table_schema;

-- 2. Who can read finance, and how they were granted it.
SELECT grantee, table_schema, table_name, privilege_type, grantor
FROM finance.information_schema.table_privileges
WHERE privilege_type IN ('SELECT', 'MODIFY')
ORDER BY grantee;

-- 3. Columns that look personal, so the classification work has a starting point.
SELECT table_schema, table_name, column_name, full_data_type
FROM main.information_schema.columns
WHERE lower(column_name) RLIKE '(email|phone|ssn|tax_id|iban|birth)'
ORDER BY table_schema, table_name;
```

The third one pairs naturally with the automatic classification Unity Catalog can run for you, but a regular expression over column names finds the obvious cases in seconds and costs nothing.

## Common mistakes

- **Expecting to see everything.** The rows are filtered by your privileges. Run an inventory query as a service principal with broad grants if you need the real total, and say in the report which identity produced it.
- **Forgetting `hive_metastore` is excluded.** A migration inventory built only from `information_schema` will quietly miss the tables you are migrating away from.
- **Using it for usage questions.** How often a table is read is not in there. That is `system.access` and `system.query`, in [[system-tables]].
- **Filtering on `table_type` and getting surprised.** Views, materialized views and streaming tables are all in `tables`, distinguished by that column. An inventory of "tables" that includes 400 views is usually a missing predicate.
- **Writing it as a one-off.** These queries age well. The ones you run twice belong in a dashboard or an alert, not in your notebook history.
