---
id: lakehouse-federation
title: Lakehouse Federation
area: catalog
level: intermediate
summary: Query MySQL, PostgreSQL, Snowflake, Glue and others from Unity Catalog without moving the data, through connections and foreign catalogs, read-only and with pushdown.
prerequisites: [unity-catalog-overview, managed-vs-external-tables]
related: [lakeflow-connect, ingestion-jdbc-rest, opensharing-overview, query-profile, secrets-management]
exams:
  - cert: de-professional
    domain: "Data Sharing and Federation"
    objective: "Configure Lakehouse Federation with proper governance across the supported source systems."
sources:
  - url: https://docs.databricks.com/aws/en/query-federation/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/query-federation/database-federation
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/query-federation/catalog-federation
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/sql/language-manual/functions/remote_query
    checked: 2026-09-11
aliases: [query federation, catalog federation, foreign catalog, connection, federated query, hive metastore federation, remote_query, REFRESH FOREIGN]
updated: 2026-09-11
status: published
maturity: ga
---

## What it is

**Lakehouse Federation** lets you query data that lives in another system as if it were a catalog in your metastore. You register a **connection** holding the location and credentials of the external system, create a **foreign catalog** from that connection, and its schemas and tables then appear in Unity Catalog (see [[unity-catalog-overview]]) with the usual three-level naming, the usual `GRANT`, and the usual lineage and search. No copy, no ingestion job.

It comes in two shapes that people routinely conflate:

- **query federation** pushes your SQL down to an external relational database over JDBC, so part of the work runs on that database's compute;
- **catalog federation** connects to an external *catalog* (Hive metastore, AWS Glue, Snowflake, Palantir Foundry, Salesforce Data 360) and then reads the files **directly from object storage** on Databricks compute.

Both are read-only. The single exception is federating a workspace's own legacy Hive metastore, where foreign tables remain writeable.

## Why it exists

The ordinary way to query an operational Postgres from a notebook is a JDBC read with a host, a user and a password in the cell (see [[ingestion-jdbc-rest]]). It works, and it puts credentials in every notebook that needs them, outside any permission model, invisible to lineage, and impossible to revoke without hunting them down. The ordinary way to avoid that is to ingest everything, which is correct for a production feed and absurd for a table somebody wants to join against once.

Federation gives the third answer: register the credential once as a securable, grant people access to tables rather than to the database, and let the query run where the data is. For catalog federation the motivation is different again: it is the migration path off Hive metastore or Glue, where half your tables are governed by Unity Catalog and half are not, and you would rather not rewrite every job on the same weekend.

## How it works

### Connection, then foreign catalog

A **connection** is a Unity Catalog securable holding the path and the credentials of the external system. Creating one needs the `CREATE CONNECTION` privilege on the metastore. Put the credentials in secrets rather than in the statement, see [[secrets-management]].

A **foreign catalog** mirrors one database from that system. Creating one needs `CREATE CATALOG` on the metastore plus either ownership of the connection or `CREATE FOREIGN CATALOG` on it. Credentials come from the connection, so the catalog statement carries none. Create it from the UI and both steps happen together.

### The two shapes side by side

| | Query federation | Catalog federation |
| --- | --- | --- |
| Sources | MySQL, PostgreSQL, Teradata, Oracle, Amazon Redshift, Salesforce Data 360, Snowflake, SQL Server, Azure Synapse, BigQuery, Databricks | legacy Databricks Hive metastore, external Hive metastore, AWS Glue, Salesforce Data 360, Snowflake, Palantir Foundry |
| Where the query runs | pushed down to the remote engine over JDBC, plus Databricks | Databricks compute only, reading object storage |
| Cost profile | you pay twice: remote compute and Databricks | one engine, cheaper and faster |
| Writes | no | no, except a federated internal Hive metastore |
| Good for | ad hoc reporting, proofs of concept, live operational data | incremental migration to Unity Catalog, long-term hybrid estates |

### Requirements

Databricks Runtime 13.3 LTS or above on Standard or Dedicated access mode, or a pro or serverless SQL warehouse on 2023.40 or above, plus network connectivity from the compute to the remote system. Dedicated access mode only works for the user who owns the connection.

### Pushdown, and where it stops

Query federation rewrites your statement into something the remote engine can run and pushes down as much as it can. How much is per-source: each connector's documentation has a supported-pushdown section, and you can see what actually went across by opening the foreign data source scan node in the [[query-profile]] or by running `EXPLAIN FORMATTED`. If a filter or aggregate did not push down, it is being done in Databricks on rows that travelled the wire first.

Two limits matter more than the pushdown list. For each foreign table referenced, Databricks runs one subquery on the remote system and streams the result back to **a single executor task**; a result set that is too large runs that executor out of memory. And query caching, both result cache and disk cache, does not apply to federated queries, so `use_cached_result` buys you nothing and every rerun pays the full remote cost again.

Concurrency is governed by the SQL warehouse's concurrent query limit rather than by anything per connection.

### Metadata refresh

Unity Catalog refreshes foreign table metadata at query time, so a schema change upstream is picked up on the next query. Refresh by hand with `REFRESH FOREIGN CATALOG`, `REFRESH FOREIGN SCHEMA` or `REFRESH FOREIGN TABLE` in two cases: when external engines read the same paths and bypass Databricks Runtime, which never triggers the automatic refresh; and to keep the refresh out of the critical path of a query, which is worth doing right after creating a catalog, since the first query otherwise triggers a full one.

### Authorized paths, for Hive metastore federation

When the foreign catalog is backed by a Hive metastore, you supply **authorized paths**: the storage prefixes tables in that catalog are allowed to live under. This is not bureaucracy. A Hive metastore that lets users edit table locations means a user with `SELECT` on a harmless table can repoint it at a prefix holding sensitive data, and the next federated refresh will happily follow. Authorized paths cap what federation can ever reach.

### `remote_query`, the escape hatch

In Databricks SQL and Databricks Runtime 18.3 and above, `remote_query` runs a query you wrote on the remote engine, using a connection's credentials, and returns the result as a table. Use it when the foreign catalog's pushdown is not getting you what you need and you would rather hand the remote optimiser your own SQL.

It takes named parameters, the first being the connection name, then connector options (`query` or `table` for SQL databases, `collection` for NoSQL, `fetchSize` on JDBC-like connections). Supported connection types are BigQuery, JDBC, MySQL, Oracle, PostgreSQL, Redshift, Snowflake, SQL Server and Teradata; anything else raises `CONNECTION_TYPE_NOT_SUPPORTED_FOR_REMOTE_QUERY_FUNCTION`. It cannot be used in a streaming query.

### When to ingest instead

Where a source is supported by both Lakehouse Federation and [[lakeflow-connect]], Databricks recommends the managed connector as soon as data volume or latency matter: federation is bounded by the remote system's capacity and by that single-stream return path. The middle ground is a materialized view defined over federated tables, which Databricks recommends for loading external data: the remote query runs on a schedule instead of on every dashboard refresh.

## Example: a PostgreSQL foreign catalog

```sql
CREATE CONNECTION pg_orders TYPE postgresql
  OPTIONS (
    host 'orders.internal.example.com',
    port '5432',
    user secret('prod-db', 'pg-user'),
    password secret('prod-db', 'pg-password')
  );

CREATE FOREIGN CATALOG IF NOT EXISTS orders_live
  USING CONNECTION pg_orders
  OPTIONS (database 'orders');

GRANT USE CATALOG ON CATALOG orders_live TO `analysts`;
GRANT SELECT ON SCHEMA orders_live.public TO `analysts`;

-- reads live from Postgres; filter and aggregate push down where the connector supports it
SELECT status, count(*) AS n
FROM orders_live.public.orders
WHERE created_at >= current_date() - INTERVAL 1 DAY
GROUP BY status;

-- materialize the join once a night instead of on every dashboard load
CREATE MATERIALIZED VIEW main.gold.orders_enriched AS
SELECT o.order_id, o.status, c.segment
FROM orders_live.public.orders o
JOIN main.silver.customers c ON c.customer_id = o.customer_id;

-- hand the remote engine your own SQL when pushdown is not enough
SELECT * FROM remote_query('pg_orders',
  query => 'SELECT status, count(*) FROM orders WHERE created_at > now() - interval ''1 day'' GROUP BY status');
```

```sql
REFRESH FOREIGN CATALOG orders_live;
REFRESH FOREIGN SCHEMA orders_live.public;
REFRESH FOREIGN TABLE orders_live.public.orders;
```

## Common mistakes

- **Pointing a production pipeline at a foreign catalog.** Every run hits the operational database, with no caching and a single-stream return path. Federation is for ad hoc work, exploration and migration; a recurring feed belongs in Lakeflow Connect or a materialized view.
- **Selecting a large table without a predicate.** The remote result comes back to one executor task, so a `SELECT *` on a fact table is an out-of-memory error rather than a slow query.
- **Assuming a filter pushed down.** Check the foreign scan node in the query profile. A `WHERE` on a function the connector does not translate means the whole table crosses the wire first.
- **Putting the password in the `CREATE CONNECTION` statement.** It ends up in query history and notebooks. Use `secret()`.
- **Federating a Hive metastore without authorized paths.** Anyone who can edit table locations upstream can redirect a federated table at data they were never granted.
- **Expecting case-sensitive names to survive.** Table and schema names are lowercased in Unity Catalog, names that are invalid identifiers are skipped entirely, and Synapse and Redshift connections cannot federate case-sensitive identifiers at all.

> [!exam]
> The objective asks for federation "with proper governance", so the sequence is what is being tested: connection first, then foreign catalog from that connection, then `GRANT` on the catalog's objects, with `CREATE CONNECTION` and `CREATE FOREIGN CATALOG` as the privileges involved. Know that federated queries are read-only, that the foreign catalog mirrors one remote database, and that both flavours are Lakehouse Federation: query federation pushes down over JDBC, catalog federation reads object storage on Databricks compute and is the cheaper of the two. When a question weighs federation against ingestion on volume or latency, the expected answer is a managed connector.
