---
id: unity-catalog-lineage
title: Data lineage in Unity Catalog
area: catalog
level: intermediate
summary: Unity Catalog captures table and column lineage automatically for queries on governed objects, filters the graph by your privileges, and exposes it as system tables and an external lineage API.
prerequisites: [unity-catalog-overview, system-tables]
related: [system-tables, privileges-grant-revoke, managed-vs-external-tables, pipelines-overview, medallion-architecture]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-lineage
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/admin/system-tables/lineage
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/external-lineage
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/access-control/privileges-reference
    checked: 2026-09-11
aliases: [lineage, column lineage, table lineage, table_lineage, external lineage, impact analysis]
updated: 2026-09-11
status: published
maturity: ga
---

## What it is

**Lineage** is the record of which object produced which other object. Unity Catalog builds it for you: every time a query reads or writes a governed table, view, volume, model or function, the metastore records the edge, down to the **column** level. There is nothing to instrument and nothing to annotate. The graph is aggregated across every workspace attached to the metastore, so a table written in the ingestion workspace and read in the analytics workspace is one connected picture rather than two.

Lineage shows up in three places: the **Lineage** tab in Catalog Explorer, where you expand upstream and downstream nodes; the **lineage system tables**, where you query it as SQL; and the lineage APIs, where you read it programmatically or extend it beyond Databricks.

## Why it exists

Two questions come up constantly and neither has a cheap answer without lineage. The first is impact analysis: "if I drop this column, what breaks?" The second is provenance: "the number on this dashboard is wrong, where did it come from?" Teams answered both by grepping notebooks and asking around, which scales badly and is wrong as soon as somebody writes a job you have not read.

Catalogues that ask you to declare lineage by hand fail for the same reason documentation fails: the declaration drifts from the code. Unity Catalog derives lineage from the query plans it already executes, so it cannot drift. That is also why its limits are exactly where the plan stops being visible to it.

## How it works

### What gets captured

Capture happens for queries expressed through the Spark DataFrame API or through Databricks SQL interfaces such as notebooks and the SQL editor. Alongside the data objects, the graph records the **workload** that created the edge: notebooks, jobs, pipelines, dashboards and SQL queries all appear as nodes you can pivot on.

| Requirement | Minimum |
| --- | --- |
| Lineage for streaming between Delta tables | Databricks Runtime 11.3 LTS and above |
| Column lineage for Lakeflow pipeline workloads | Databricks Runtime 13.3 LTS and above |

Lineage captured from **1 September 2024** onwards is available. In Catalog Explorer and the API it is kept indefinitely; the system tables keep a rolling one-year window.

### What does not get captured

The gaps are worth memorising, because each one produces a graph that looks complete and is not:

- **RDD operations.** Drop to RDDs and the edge disappears.
- **Path references.** Reading or writing through a path rather than a name, for example `spark.read.load("s3://acme-prod-data/orders/")`, gives you no column lineage, and the table-level record carries only the path. This is the practical argument for registering data as a table rather than reading the bucket directly, on top of the one in [[managed-vs-external-tables]].
- **Global temporary views** and **`system.information_schema`**.
- **Renames.** Lineage is not preserved when you rename a catalog, schema, table, view or column. A rename is a new node.
- **UDFs**, which get table-level lineage only, and do not appear in the lineage system tables at all.

### How privileges filter the graph

Lineage obeys the same permission model as everything else in [[privileges-grant-revoke]]. You need at least `BROWSE` on the parent catalog to see an object's lineage, and `BROWSE` or `SELECT` on the object itself to explore it. Objects you cannot see are **masked** in the graph: you are told an upstream exists, but you cannot expand it or learn its name.

This is the correct behaviour and it surprises people. Two users looking at the same table can see genuinely different graphs, and neither of them is looking at a bug. If a lineage view looks suspiciously shallow, check privileges before you check capture.

### The lineage system tables

`system.access.table_lineage` and `system.access.column_lineage` are both GA (see [[system-tables]] for how the system catalog is governed). Every row is one read or write event, not a summary, so counting rows tells you about traffic and `DISTINCT` tells you about structure.

| Column group | Columns |
| --- | --- |
| Source | `source_table_full_name`, `source_table_catalog`, `source_table_schema`, `source_table_name`, `source_path`, `source_type` |
| Target | `target_table_full_name`, `target_table_catalog`, `target_table_schema`, `target_table_name`, `target_path`, `target_type` |
| Workload | `entity_type`, `entity_id`, `entity_run_id`, `entity_metadata`, `statement_id` |
| Event | `created_by`, `event_time`, `event_date`, `event_id`, `record_id`, `direct_access` |

`column_lineage` adds `source_column_name` and `target_column_name`, and it excludes events with no source data. `entity_type` is one of `NOTEBOOK`, `JOB`, `PIPELINE`, `DASHBOARD_V3`, `DBSQL_DASHBOARD` (deprecated), `DBSQL_QUERY`, or `NULL`. For external tables addressed by path, filter on `source_path` and `target_path` rather than the name columns.

### External lineage

Lineage stops at the edge of Databricks, which leaves the two ends of most real pipelines invisible: the Salesforce or MySQL system the data came from, and the Tableau or Power BI report that consumes it. **External lineage** closes that by letting you register those things as **external metadata objects**, each with a system type, an entity type such as table or dashboard, optional column names for column-level mapping, and free-form JSON properties.

You then declare upstream or downstream relationships between an external metadata object and a table, model, path or another external object, through Catalog Explorer, the External Lineage API or the Python SDK. Creating one needs `CREATE EXTERNAL METADATA` on the metastore; declaring a relationship needs `MODIFY` on the external metadata object plus read privileges for a downstream link or write privileges for an upstream one.

One caveat that catches people building reports: external lineage is **not** written to `system.access.table_lineage` or `system.access.column_lineage`. It lives in the graph and the API only.

## Example: impact analysis before dropping a column

Everything downstream of one column, and which workload created each edge:

```sql
SELECT DISTINCT
  target_table_full_name,
  target_column_name,
  entity_type,
  entity_id
FROM system.access.column_lineage
WHERE source_table_full_name = 'main.silver.orders'
  AND source_column_name     = 'customer_email'
  AND event_date >= current_date() - INTERVAL 90 DAYS
ORDER BY target_table_full_name;
```

The jobs and notebooks that write a gold table, ranked by how often they touch it:

```sql
SELECT entity_type, entity_id, COUNT(*) AS writes, MAX(event_time) AS last_write
FROM system.access.table_lineage
WHERE target_table_full_name = 'main.gold.revenue_daily'
  AND event_date >= current_date() - INTERVAL 30 DAYS
GROUP BY ALL
ORDER BY writes DESC;
```

Tables read straight from a path rather than through the catalogue, which is where column lineage goes missing:

```sql
SELECT DISTINCT source_path, target_table_full_name, entity_type
FROM system.access.table_lineage
WHERE source_path IS NOT NULL
  AND event_date >= current_date() - INTERVAL 30 DAYS;
```

## Common mistakes

- **Reading a lineage graph as proof that nothing else uses a table.** RDD jobs, path reads and objects you lack privileges on are all invisible to you. Absence of an edge is weak evidence.
- **Renaming a table and expecting history to follow.** It does not. If you need continuity, keep the name and change the contents, or accept the break and record it.
- **Querying `source_table_full_name` for external tables.** When the source is addressed by path, that column is null and `source_path` holds the value.
- **Assuming lineage is a quota on access.** Lineage records what happened; it grants nothing. A user who can see an edge still needs `SELECT` to read the data.
- **Expecting external lineage in the system tables.** It is deliberately excluded, so a report built purely on `table_lineage` will show your pipeline ending at the last Databricks table.
- **Counting rows in `table_lineage` as "number of users".** One query can emit several rows, one per source. Use `DISTINCT` on `created_by` or `entity_id`.

> [!tip]
> The fastest lineage query in practice is not SQL at all: open the table in Catalog Explorer, switch to the Lineage tab and expand one level. Use the system tables when you need the answer for hundreds of tables at once, or when you want the answer on a schedule rather than on a screen.
