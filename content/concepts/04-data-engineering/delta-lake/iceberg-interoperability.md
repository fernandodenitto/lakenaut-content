---
id: iceberg-interoperability
title: Iceberg on Databricks
area: delta-lake
level: intermediate
summary: Managed Iceberg tables, foreign Iceberg tables, Iceberg reads on Delta, and the REST catalog that lets an engine outside Databricks read the same rows.
prerequisites: [delta-lake-overview, managed-vs-external-tables]
related: [managed-vs-external-tables, lakehouse-federation, unity-catalog-overview, opensharing-overview, delta-lake-overview]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/iceberg/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/external-access/iceberg
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/delta/uniform
    checked: 2026-09-12
aliases: [iceberg, apache iceberg, uniform, universal format, iceberg reads, iceberg rest catalog, managed iceberg, foreign iceberg]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

Apache Iceberg is the other open table format, and Databricks meets it in four different places. They are easy to confuse because all four involve the word Iceberg and only one of them is about writing Iceberg tables on Databricks.

| Shape | Who writes it | Who reads it | Where it lives |
| --- | --- | --- | --- |
| **Managed Iceberg table** | Databricks, and external engines through the REST catalog | anyone | Unity Catalog, storage managed by Databricks |
| **Foreign Iceberg table** | another system | Databricks, read-only | another catalog, registered through federation |
| **Iceberg reads on a Delta table** | Databricks, as Delta | external Iceberg clients, read-only | your Delta table, with Iceberg metadata generated next to it |
| **Iceberg REST catalog** | not a table at all | the endpoint external engines talk to | `/api/2.1/unity-catalog/iceberg-rest` |

The first is a table format choice. The second is federation. The third is a compatibility layer. The fourth is the door all of them are reached through from outside.

## Why it exists

The lakehouse argument only works if the data is not locked into one engine. For years that promise had a gap: Delta was the native format, Iceberg was what half the industry standardised on, and moving between them meant copying.

Each of the four shapes closes a different part of that gap. Managed Iceberg lets you write the format others expect without giving up Unity Catalog. Federation lets you query somebody else's Iceberg without ingesting it. Iceberg reads let an existing Delta table be read by an Iceberg client without a rewrite. The REST catalog gives all of them a single, standard address.

## How it works

### Managed Iceberg tables

A managed Iceberg table is a Unity Catalog managed table whose format is Iceberg rather than Delta. It keeps the things that make managed tables worth using. The lifecycle belongs to Unity Catalog, [[liquid-clustering]] works on it, [[predictive-optimization]] covers it, and materialized views and streaming tables can be built on top.

Two requirements are worth knowing before you plan around it. It needs Databricks Runtime 16.4 LTS or above, and it needs a workspace with serverless compute enabled, because Databricks uses serverless to maintain the Iceberg metadata in the background.

> [!note]
> Managed Iceberg **materialized views** are a narrower case and still in Public Preview, with enablement through your account team. The base tables are generally available; the derived ones are not yet.

### Foreign Iceberg tables

A foreign Iceberg table is somebody else's table, registered into Unity Catalog through [[lakehouse-federation]] from AWS Glue, a Hive metastore or Snowflake. Databricks reads it and does not write it.

The behaviour that surprises people is refresh. A foreign Iceberg table does not pick up changes to its metadata automatically: you run `REFRESH FOREIGN TABLE` when the owning system has moved on. Credential vending is also not supported on them, which matters if you were planning to hand access through to a third engine.

### Iceberg reads on a Delta table

This is the feature that used to be called UniForm. Turning on Iceberg reads makes Databricks generate Iceberg metadata alongside the Delta metadata, over the same Parquet files, so an Iceberg client can read the table without anything being copied or rewritten. Universal Format survives as the name of that metadata layer underneath, which is why the table property still says so.

It is available from Databricks Runtime 14.3 LTS and above. The direction only goes one way: Iceberg clients read, Databricks writes.

```sql
-- One table, two metadata layers, one set of files.
ALTER TABLE main.gold.orders
  SET TBLPROPERTIES ('delta.enableIcebergCompatV2' = 'true', 'delta.universalFormat.enabledFormats' = 'iceberg');
```

### The REST catalog, and what it opens

External engines reach all of this through the Unity Catalog Iceberg REST catalog, an implementation of the standard Iceberg REST specification at `/api/2.1/unity-catalog/iceberg-rest`. Spark, Flink and Trino clients speak it out of the box.

What an engine may do depends on the table:

- **managed Iceberg tables**: read and write;
- **foreign Iceberg tables, managed Delta tables, and external Delta tables with Iceberg reads on**: read only.

Two things have to be switched on first. External data access must be enabled on the metastore, and the principal needs `EXTERNAL USE SCHEMA` on the schema. That privilege is the point of control: without it, the REST catalog returns nothing, whatever the table grants say. Authentication is OAuth or a personal access token, and the token path is the legacy one.

Unity Catalog also refuses duplicate data file commits from external engines, which is the Iceberg specification's own rule rather than a Databricks restriction.

## Example: one table, two audiences

```sql
-- The analytics team stays on Delta.
CREATE TABLE main.gold.daily_revenue
  CLUSTER BY (order_date)
  AS SELECT order_date, sum(amount) AS revenue FROM main.silver.orders GROUP BY order_date;

-- The data science platform runs Trino and wants Iceberg. Nothing is copied.
ALTER TABLE main.gold.daily_revenue
  SET TBLPROPERTIES ('delta.universalFormat.enabledFormats' = 'iceberg');

-- Then, once, by an administrator: enable external data access on the metastore and
GRANT EXTERNAL USE SCHEMA ON SCHEMA main.gold TO `platform-engineering`;
```

The Trino side points at the REST catalog endpoint and reads `main.gold.daily_revenue` as an Iceberg table. When the pipeline rewrites the Delta table tomorrow, the Iceberg metadata follows.

## Common mistakes

- **Assuming Iceberg reads make the table writable from outside.** They do not. Only a managed Iceberg table takes writes from an external engine, and even then through the REST catalog.
- **Forgetting `REFRESH FOREIGN TABLE`.** A foreign Iceberg table that looks stale usually is stale. Nothing polls the source catalog for you.
- **Granting table privileges and stopping there.** External access also needs the metastore setting and `EXTERNAL USE SCHEMA`, and the failure looks like the table does not exist.
- **Choosing managed Iceberg for everything.** It costs you nothing in features, but it does require serverless compute and a recent runtime. If neither is available, Delta with Iceberg reads gets you most of the interoperability.
- **Saying UniForm and meaning the current feature.** The metadata layer is still called Universal Format, but the feature is Iceberg reads, and the documentation page was retitled accordingly. The [rename list](/naming/) has the dates if a colleague insists otherwise.
