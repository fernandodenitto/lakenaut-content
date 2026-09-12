---
id: zerobus-ingest
title: Zerobus Ingest
area: data-ingestion
level: intermediate
summary: Writing records straight into a Unity Catalog table from an application, over gRPC for throughput or REST for edge fleets, with no message bus in between.
prerequisites: [ingestion-patterns, managed-vs-external-tables]
related: [ingestion-patterns, kafka-streaming, auto-loader, streaming-tables-sql, lakeflow-connect]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/ingestion/zerobus-ingest
    checked: 2026-09-12
aliases: [zerobus, direct write, push ingestion, grpc ingest, edge ingestion]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

Zerobus Ingest is a write API. An application calls it and the records land in a Unity Catalog Delta table, queryable within seconds. There is no topic, no connector, no landing zone and no file to pick up afterwards.

It comes in two shapes, and the choice between them is about the shape of the producer rather than the volume:

| Interface | Best for | Why |
| --- | --- | --- |
| SDKs over gRPC | high-volume streaming producers | a persistent connection gives the highest sustained throughput |
| REST | large fleets of light or chatty devices | stateless, so ten thousand devices do not hold ten thousand connections |

The SDKs are generally available for Python, Rust, Java, Go and TypeScript. The C++ and C# SDKs are in Beta.

## Why it exists

The standard answer to "my application produces events and I want them in the lakehouse" has been a message bus. Put Kafka in the middle, have the application produce to a topic, have a streaming job consume it and write Delta. It works, and for many organisations it is the right architecture, because the bus does more than transport: it fans out to several consumers, it buffers, it replays.

But plenty of cases need none of that. One producer, one destination table, nobody else reading the topic. There the bus is infrastructure you run, pay for and page somebody about, in order to move bytes from one place that already exists to another place that already exists. Zerobus removes it for exactly that case.

## How it works

### What you write into

Records go into Unity Catalog Delta tables and into streaming tables, which means the destination is governed like everything else: grants, lineage and audit apply from the first write.

> [!note]
> Ingesting into tables backed by **default storage** is in Public Preview. Writing into an ordinary managed table is not, so read the label before planning around the newer path.

### Choosing it, or not

The question is not throughput, it is what else needs the data.

- **One producer, one table, nobody else consuming**: Zerobus. There is nothing for the bus to do.
- **Several consumers, or replay matters**: keep the bus. See [[kafka-streaming]]. A topic that three teams read is not a transport detail, it is an interface.
- **Files arriving in object storage**: [[auto-loader]]. Zerobus is for applications that hold the record in memory, not for files somebody else dropped.
- **A SaaS application or an operational database**: [[lakeflow-connect]], where somebody already wrote the connector.

### What you give up

A bus buffers when the destination is slow and replays when the consumer was wrong. Writing directly means the producer owns both problems: if the write fails, the application decides whether to retry, drop or spool locally, and if the schema turns out wrong there is no topic to re-read.

That is a fair trade for telemetry and for events whose value decays in minutes. It is a poor trade for financial transactions that must be reprocessable.

## Example: where it fits in a bronze layer

A fleet of devices posts readings over REST into `main.bronze.device_readings`. A [[streaming-tables-sql|streaming table]] reads from that bronze table and produces a typed, filtered silver table on a fifteen-minute schedule. The medallion shape is unchanged, as described in [[medallion-architecture]]; the only thing that changed is that bronze is fed by a write rather than by a file or a topic.

The useful property is that the boundary stays in the same place. If the fleet grows to the point where a bus earns its keep, the silver layer does not change: only what feeds bronze does.

## Common mistakes

- **Replacing a bus that other teams read from.** The topic was the interface. Removing it moves the coupling into your application instead of removing it.
- **Forgetting the producer now owns retries.** There is no buffer behind you. Decide what the application does when the write fails, and decide it before the first outage.
- **Assuming the newest write target is settled.** Writing into default-storage tables is in Public Preview. Ordinary managed tables are the safe destination today.
- **Picking gRPC for edge devices.** Thousands of light producers holding persistent connections is the case REST exists for.
- **Treating it as a replacement for change capture.** Zerobus carries what your application chooses to send. It does not observe a database, which is what [[lakeflow-connect|the managed connectors]] and change capture do.
