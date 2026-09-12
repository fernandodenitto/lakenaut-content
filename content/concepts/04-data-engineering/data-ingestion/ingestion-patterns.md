---
id: ingestion-patterns
title: "Ingestion patterns: batch, streaming, incremental"
area: data-ingestion
subarea: overview
level: beginner
summary: Batch, streaming and incremental are the three ways into the lakehouse, served by UI uploads, standard connectors and Lakeflow Connect. Choosing between them is an exam question.
prerequisites: [platform-architecture, delta-lake-overview]
related: [auto-loader, copy-into, lakeflow-connect, ingestion-jdbc-rest, semi-structured-data, medallion-architecture, unity-catalog-overview]
exams:
  - cert: de-associate
    domain: "Data Ingestion and Loading"
    objective: "Enable and detail data ingestion patterns, including batch, streaming, and incremental loading, and import data from sources such as local files, Lakeflow Connect standard connectors, and Lakeflow Connect managed connectors."
  - cert: de-associate
    domain: "Data Ingestion and Loading"
    objective: "Prioritize between Auto Loader, Lakeflow Connect (standard and managed connectors), partner connectors, and other ingestion methods based on technical requirements such as data volume, ingestion frequency, data types, and governance needs with Unity Catalog."
sources:
  - url: https://docs.databricks.com/aws/en/ingestion/
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/ingestion/file-upload/upload-data
    checked: 2026-09-09
aliases: [ingestion, data ingestion, data loading, batch vs streaming, incremental load]
updated: 2026-09-09
status: published
---

## What it is

**Ingestion** is the first step of every pipeline: bringing data from an external source (files, databases, SaaS applications, message queues) into a Delta table governed by Unity Catalog, usually in the bronze layer (see [[medallion-architecture]]). Databricks groups all ingestion tools under the name **Lakeflow Connect**, distinguishing between **standard connectors** and **managed connectors**.

Three patterns describe *how* the data arrives:

| Pattern | What it does | Example |
| --- | --- | --- |
| **Batch** | loads a finite set of data at a defined point in time | nightly CSV export, manual upload |
| **Streaming** | processes data continuously as it arrives | Kafka events, application logs |
| **Incremental** | on each run, loads only what is new since the last time | new files in a bucket, changed rows in a database |

Incremental is the most important pattern for the exam: it sits between the other two, because it runs as a scheduled batch but with the "only the delta" logic typical of streaming.

## Why it exists

Reloading everything every time is simple but expensive and slow, and it stops scaling as soon as volumes grow. Pure streaming solves latency but needs compute that's always on. Incremental ingestion takes the best of both: a job that starts on a fixed schedule, reads only the new files or rows, and stops. Auto Loader with the `availableNow` trigger (see [[auto-loader]]) and `COPY INTO` (see [[copy-into]]) are exactly that.

## How it works

### Uploading local files from the UI

The simplest case: you have a CSV, JSON, or Parquet file on your machine. From the **+ New** → **Add or upload data** menu you can upload the file to a Unity Catalog **volume** (5 GB per file limit from the UI) and then, with **Create table**, generate a table by choosing catalog, schema, name, column types, and columns to exclude. You need the `WRITE VOLUME` privilege on the volume and table-creation permissions on the schema. It's a manual batch pattern: good for prototypes and lookup tables, not for production.

### Standard connectors

These are the tools you configure yourself, with code or SQL, for generic sources:

- **Auto Loader** (`cloudFiles`): files in object storage, incremental, with schema inference and evolution. See [[auto-loader]].
- **COPY INTO**: idempotent SQL command for loading files from storage. See [[copy-into]].
- **Structured Streaming** over **Apache Kafka**, **Amazon Kinesis**, **Google Pub/Sub**: true streaming, with exactly-once guarantees.
- **JDBC / REST APIs** from a notebook: for sources without a connector. See [[ingestion-jdbc-rest]].
- **SFTP**: files from remote servers.

You can use them at three increasing levels of automation: Structured Streaming directly, inside a Lakeflow Spark Declarative Pipeline, or in Databricks SQL with `CREATE STREAMING TABLE`.

### Managed connectors

These are ready-made connectors for specific sources, where Databricks takes care of authentication, CDC, edge cases, and API maintenance. Two families:

- **SaaS**: Salesforce, Workday, ServiceNow, HubSpot, Jira, Google Analytics, and dozens more.
- **Databases**: SQL Server, PostgreSQL, MySQL, and others, via change data capture.

They run on serverless, write to **streaming tables** governed by Unity Catalog, and can be created from the UI, API, CLI, or bundles. Details in [[lakeflow-connect]].

### Partner connectors

Fivetran, Informatica, and other partners integrate through **Partner Connect**: useful when the source has no managed connector or the tool is already in-house.

### Decision table

| Need | Choice | Why |
| --- | --- | --- |
| Thousands of files per day in S3/ADLS/GCS | Auto Loader | scales, incremental, schema evolution |
| A few hundred files, simple SQL command | COPY INTO | idempotent, no checkpoint to manage |
| Salesforce, Workday, SQL Server with CDC | Lakeflow Connect managed | zero code, managed CDC |
| Real-time events from Kafka | Structured Streaming | seconds of latency |
| Database without a managed connector | JDBC from a notebook | flexibility, orchestrated with Lakeflow Jobs |
| Source covered only by a partner tool | Partner Connect | ready-made integration |
| One-off file for a prototype | UI upload | zero setup |

The Databricks rule: start from the **most managed** tier and go down only if it doesn't cover the source or the requirements.

## Example

The same bucket of JSON files loaded with the two most common standard connectors.

```sql
COPY INTO shop.bronze.orders
FROM '/Volumes/shop/landing/orders/'
FILEFORMAT = JSON
COPY_OPTIONS ('mergeSchema' = 'true');
```

```python
(spark.readStream.format("cloudFiles")
  .option("cloudFiles.format", "json")
  .option("cloudFiles.schemaLocation", "/Volumes/shop/landing/_checkpoints/orders")
  .load("/Volumes/shop/landing/orders/")
  .writeStream
  .option("checkpointLocation", "/Volumes/shop/landing/_checkpoints/orders")
  .trigger(availableNow=True)
  .toTable("shop.bronze.orders"))
```

Both load only new files on each run: they are incremental. The first is a SQL command you can run from a SQL warehouse; the second is a stream that runs as a batch and exits when it's done.

## Common mistakes

- Reloading the entire source every night with `INSERT OVERWRITE` when an incremental load would do.
- Hand-writing a JDBC connector for SQL Server or Salesforce when a managed connector exists.
- Using the UI upload in production: no scheduling, no traceability.
- Confusing streaming with "real time": an Auto Loader job with `availableNow` uses the streaming APIs but is, for all practical purposes, an incremental batch.
- Landing data on DBFS or in legacy Hive tables instead of Unity Catalog.

> [!exam]
> Expect "pick the right tool" questions with constraints on volume, frequency, data type, and governance. The associations to remember: **many files in object storage → Auto Loader**; **few files, SQL → COPY INTO**; **SaaS or enterprise database → Lakeflow Connect managed**; **Kafka → Structured Streaming**; **exotic source → JDBC/REST in a notebook orchestrated by Lakeflow Jobs**. The exam explicitly distinguishes **standard** connectors (you configure them) from **managed** ones (Databricks handles authentication and CDC), and expects you to know that local files are uploaded to a Unity Catalog volume from the UI.
