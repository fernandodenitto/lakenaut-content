---
id: lakeflow-connect
title: "Lakeflow Connect: managed connectors"
area: data-ingestion
subarea: managed-connectors
level: intermediate
summary: Lakeflow Connect managed connectors ingest SaaS applications and databases into Unity Catalog streaming tables, with authentication, change data capture and scheduling handled for you.
prerequisites: [ingestion-patterns, unity-catalog-overview]
related: [auto-loader, ingestion-jdbc-rest, pipelines-overview, jobs-triggers, bundles-overview]
exams:
  - cert: de-associate
    domain: "Data Ingestion and Loading"
    objective: "Configure Lakeflow Connect to reliably ingest data from diverse enterprise sources into Unity-Catalog-governed tables."
sources:
  - url: https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/saas-overview
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/sql-server-overview
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/salesforce
    checked: 2026-09-09
aliases: [lakeflow connect, managed connectors, ingestion gateway, ingestion pipeline]
updated: 2026-09-09
status: published
---

## What it is

**Lakeflow Connect** is the umbrella name Databricks uses for every way of ingesting data. This page covers the **managed connectors**: prebuilt pipelines for specific enterprise sources, where Databricks handles authentication, incremental reads, schema evolution, and retries. You pick the source, the tables, and the destination; the rest is taken care of.

Two main families:

| Family | Sources (examples) | Incremental mechanism |
| --- | --- | --- |
| **SaaS** | Salesforce, Workday, ServiceNow, HubSpot, Jira, GitHub, Google Analytics, Zendesk | cursor columns (last modified) |
| **Database** | SQL Server, PostgreSQL, MySQL | change data capture (CDC) or change tracking |

There are also connectors for files (Google Drive, SharePoint), for streaming (RabbitMQ), and community or custom connectors for sources that aren't covered.

## Why it exists

Ingesting Salesforce by hand means dealing with OAuth, API limits, formula fields, deletions, schema changes, and maintaining all of it whenever Salesforce updates its APIs. For a database it means configuring CDC, reading the transaction log, and applying updates in the right order. Managed connectors move that work onto Databricks: you write zero code and get up-to-date tables in Unity Catalog. In the hierarchy of ingestion tiers (see [[ingestion-patterns]]) they are the most automated rung: you start here and drop down to standard connectors only when the source isn't covered.

## How it works

### Components

Every managed connector is made of three objects:

1. **Connection**: a Unity Catalog securable that holds the source credentials. An admin creates it; then anyone with `USE CONNECTION` can build pipelines on top of it without ever seeing the passwords.
2. **Ingestion pipeline**: a pipeline that reads from the source and writes to the destination tables. It runs on **serverless**.
3. Destination **streaming tables**: Delta tables with incremental-load support, in a catalog and schema you choose.

For **databases** there's a fourth component: the **ingestion gateway**, a continuously running pipeline that extracts changes from the source log (CDC) and stages them in a Unity Catalog volume. The ingestion pipeline then reads the staging area and applies the changes to the streaming tables. For SQL Server there's also an "integrated CDC" variant (in beta) that merges extraction and apply into a single pipeline.

### First run and subsequent runs

On the first run the connector loads all the data from the selected tables or objects (a snapshot). From then on it loads only the changes, using the mechanism that fits the source: time cursors for SaaS, CDC or change tracking for databases. For some tables or objects (Salesforce formula fields, for example) incremental loading isn't available and the connector falls back to full snapshots. You can always force a **full refresh**.

### Schema evolution and history

Connectors handle added and removed columns; type changes are not supported, and some operations (column renames on databases) require a full refresh. Many connectors support **SCD type 2**, keeping row history with validity intervals, and track deletions at the source.

### Scheduling

The ingestion pipeline is **triggered**: it runs when you launch it or on a schedule. At creation time the connector automatically creates a Lakeflow job with the chosen cadence; you can change it, or embed the pipeline as a task in a larger job (see [[jobs-triggers]]). The database gateway, on the other hand, stays on continuously.

### Creation

From the UI (**+ New** → **Add or upload data** → pick the connector), from the API, from the CLI, from a notebook with the SDK, or from a bundle (see [[bundles-overview]]). Connectors that use user-to-machine OAuth (HubSpot, Jira, Zendesk, and others) must be created from the UI because they require an interactive login.

Typical limit: 250 tables per pipeline.

## Example

Defining a Salesforce pipeline in a bundle: it ingests two objects into `crm.bronze` using an existing connection.

```yaml
resources:
  pipelines:
    salesforce_ingest:
      name: salesforce_ingest
      catalog: crm
      schema: bronze
      ingestion_definition:
        connection_name: salesforce_prod
        objects:
          - table:
              source_schema: objects
              source_table: Account
              destination_catalog: crm
              destination_schema: bronze
          - table:
              source_schema: objects
              source_table: Opportunity
              destination_catalog: crm
              destination_schema: bronze
              table_configuration:
                scd_type: SCD_TYPE_2
```

The same thing from Python with the SDK, handy in a setup notebook:

```python
from databricks.sdk import WorkspaceClient
from databricks.sdk.service import pipelines

w = WorkspaceClient()
w.pipelines.create(
    name="salesforce_ingest",
    catalog="crm",
    target="bronze",
    ingestion_definition=pipelines.IngestionPipelineDefinition(
        connection_name="salesforce_prod",
        objects=[
            pipelines.IngestionConfig(table=pipelines.TableSpec(
                source_schema="objects", source_table="Account",
                destination_catalog="crm", destination_schema="bronze")),
        ],
    ),
)
```

The result is the streaming table `crm.bronze.account`, updated on every pipeline run with only the rows that changed.

## Common mistakes

- Writing a JDBC or REST connector for a source that already has a managed connector (see [[ingestion-jdbc-rest]] for when that's actually needed).
- Forgetting that the database gateway runs continuously and costs money even when the pipeline isn't scheduled.
- Expecting the connector to handle a column type change: it needs a full refresh.
- Granting the connection to everyone: the connection holds the source credentials and should be treated like a secret.
- Confusing the **connection** (credentials, a Unity Catalog object) with the **pipeline** (what to ingest, where, when).

> [!exam]
> The exam expects you to know: managed connectors cover **SaaS** and **enterprise databases**; the destination is always a table governed by **Unity Catalog**; the building blocks are the **connection**, the **ingestion pipeline** (serverless), and, for databases, the **ingestion gateway** with CDC; loading is incremental after the first snapshot. In multiple-choice questions, "Salesforce", "Workday", "ServiceNow", "SQL Server with CDC" are signals to answer Lakeflow Connect, not Auto Loader or JDBC.
