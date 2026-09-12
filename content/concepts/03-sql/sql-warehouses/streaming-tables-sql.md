---
id: streaming-tables-sql
title: Streaming tables from Databricks SQL
area: sql-warehouses
level: intermediate
summary: A streaming table declared in the SQL editor, refreshed incrementally by a serverless pipeline the system creates for you, without opening a pipeline editor.
prerequisites: [materialized-views-sql, structured-streaming-basics]
related: [materialized-views-sql, pipelines-overview, auto-loader, kafka-streaming, gold-layer-objects]
exams:
  - cert: de-associate
    domain: "Data Ingestion and Loading"
    objective: "Load data incrementally into a managed table without writing pipeline code."
sources:
  - url: https://docs.databricks.com/aws/en/ldp/dbsql/streaming
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-ddl-create-streaming-table
    checked: 2026-09-12
aliases: [streaming table, CREATE OR REFRESH STREAMING TABLE, standalone streaming table, FROM STREAM, incremental append]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

A streaming table is a Unity Catalog managed table that only ever appends, and that keeps itself up to date by reading new rows from its source. The standalone version is the one you declare in the SQL editor with `CREATE OR REFRESH STREAMING TABLE`, without creating a pipeline, without a notebook, and without choosing any compute.

The word that makes it work is `STREAM` in the query. `FROM STREAM raw_data` reads the source with streaming semantics, which is what lets a refresh consider only the rows that arrived since last time. Leave the keyword out and you have written a batch query, and the table will re-read everything on every refresh.

It is a sibling of [[materialized-views-sql]], and the difference is the one you would expect: a materialized view holds the result of a query and can change any row; a streaming table appends, and each row is processed once.

## Why it exists

Incremental ingestion used to mean a choice between two efforts. Either you wrote a Structured Streaming job with a checkpoint, a trigger and a cluster to run it on, or you built a declarative pipeline, which is a better answer but still a separate artefact with its own editor and its own deployment.

Neither is a reasonable ask of an analyst who wants the last hour of events in a table. A streaming table declared in SQL removes the artefact: the statement is the deployment, and the plumbing, checkpoints included, is the system's problem.

## How it works

### The statement

```sql
CREATE OR REFRESH STREAMING TABLE main.silver.sales
SCHEDULE EVERY 1 HOUR
AS SELECT
  product,
  price,
  event_time
FROM STREAM main.bronze.raw_sales
WHERE price IS NOT NULL;
```

Three parts do the work. `CREATE OR REFRESH` creates it the first time and refreshes it afterwards, so the same statement is safe to re-run. `SCHEDULE` sets a cadence, and without it the table refreshes only when somebody asks. `FROM STREAM` is what makes the refresh incremental.

### What runs it, and who pays

This is the part that surprises people. The refresh does not run on your SQL warehouse. When you create the table, the system creates and manages a **dedicated serverless pipeline** for it, and that pipeline does the work, including the very first load, which starts immediately.

So the warehouse you happened to be using when you typed the statement is not billed for the refresh. The cost appears as serverless pipelines usage instead. It is the same arrangement [[materialized-views-sql|materialized views]] use, and it is worth knowing before someone goes looking for the spend on the wrong line.

### Refresh, and the one you should think twice about

A normal refresh looks only at rows that arrived after the last update, and appends them. That is the whole point.

A **full refresh** is different: it re-processes everything available in the source against the current definition. On a table fed by object storage that is merely expensive. On a table fed by a source with limited retention, such as Kafka, it is destructive in a quieter way: the data that has aged out of the topic is not there to be re-read, so a full refresh produces a table that is missing history it used to have. Databricks recommends against it for exactly that reason.

### Privileges

Two grants matter and they are separate on purpose:

| Privilege | What it allows |
| --- | --- |
| `SELECT` | read the streaming table |
| `REFRESH` | trigger a refresh of it |

Giving an analyst `SELECT` without `REFRESH` is the normal arrangement. A refresh costs money and can be triggered repeatedly, so it belongs with whoever owns the table.

### Where it sits against the alternatives

| You want | Use |
| --- | --- |
| Append new rows from a source, declared in SQL | a streaming table |
| Keep the result of a query current, including updates and deletes | [[materialized-views-sql]] |
| Several related datasets, expectations, and a graph between them | [[pipelines-overview]] |
| Full control over triggers, checkpoints and state | [[structured-streaming-basics]] |

> [!note]
> Two things on this surface are not settled. Query history for the refreshes is in Public Preview, and `REPLACE USING` flows, which keep a streaming table in sync from partial snapshots, are in Beta. The streaming table itself is generally available.

## Example: ingest files, then narrow them

```sql
-- Bronze: every file that lands, as it lands. read_files is the SQL face of Auto Loader.
CREATE OR REFRESH STREAMING TABLE main.bronze.events
SCHEDULE EVERY 15 MINUTES
AS SELECT * FROM STREAM read_files('/Volumes/main/landing/events/', format => 'json');

-- Silver: the same rows, typed and filtered. Still append-only, still incremental.
CREATE OR REFRESH STREAMING TABLE main.silver.events
SCHEDULE EVERY 15 MINUTES
AS SELECT
  cast(payload:id AS BIGINT)        AS event_id,
  cast(payload:ts AS TIMESTAMP)     AS event_time,
  payload:type::STRING              AS event_type
FROM STREAM main.bronze.events
WHERE payload:type IS NOT NULL;
```

Two statements, no cluster chosen, no checkpoint written by hand, and each refresh reads only what arrived in the last fifteen minutes. See [[auto-loader]] for what `read_files` is doing underneath, and [[medallion-architecture]] for why the two layers are separate.

## Common mistakes

- **Leaving out `STREAM`.** The statement still works, which is the trap. It becomes a batch query that re-reads the whole source on every refresh, and the bill says so before the results do.
- **Running a full refresh on a Kafka-backed table.** Anything that has aged out of the topic cannot come back. Treat a full refresh as a rebuild from a source you are certain still holds everything.
- **Looking for the cost on the warehouse.** Refreshes run on a system-managed serverless pipeline, not on the warehouse that issued the statement.
- **Expecting updates.** A streaming table appends. If rows have to change, you want a materialized view, or change capture in a pipeline.
- **Granting `REFRESH` widely.** It is a separate privilege because it spends money. Give `SELECT` to readers and keep `REFRESH` with the owner or the schedule.

> [!exam]
> Expect a question that gives you a requirement in words and asks for the object: append-only and incremental is a streaming table, recomputed results are a materialized view, several datasets with expectations is a pipeline. The `STREAM` keyword and the `SCHEDULE` clause are the two syntax details worth memorising, along with the fact that the refresh runs on serverless pipeline compute rather than on the SQL warehouse.
