---
id: data-engineering
title: "Data Engineering"
tag: "pipelines"
level: intermediate
hours: 60
order: 2
icon: workflow
summary: "Build production pipelines: ingest with Auto Loader, COPY INTO and Lakeflow Connect, transform with PySpark and SQL, orchestrate with Lakeflow Jobs, and ship it with bundles."
certs: [de-associate]
stages:
  - name: "Ingest"
    concepts: [ingestion-patterns, copy-into, auto-loader, lakeflow-connect, ingestion-jdbc-rest, semi-structured-data, structured-streaming-basics, kafka-streaming, streaming-triggers, streaming-watermarks-state, zerobus-ingest]
  - name: "Transform"
    concepts: [medallion-architecture, dataframe-columns-rows, dataframe-joins-unions, dataframe-dedup-aggregations, gold-layer-objects, dataframe-io, merge-upsert, foreachbatch, data-quality-overview, dqx-framework]
  - name: "Declare"
    concepts: [pipelines-overview, pipelines-expectations, pipelines-auto-cdc, pipelines-sql-vs-python, pipelines-event-log, pipelines-sinks]
  - name: "Orchestrate"
    concepts: [jobs-overview, jobs-task-dependencies, jobs-control-flow, jobs-triggers, jobs-parameters, jobs-repair-runs, jobs-serverless, jobs-queue-and-concurrency, jobs-continuous]
  - name: "Operate"
    concepts: [runs-monitoring, spark-ui-bottlenecks, delta-optimize-vacuum, system-tables, predictive-optimization, deletion-vectors, table-history-and-checkpoints, change-data-feed, delta-time-travel, iceberg-interoperability, data-quality-monitoring]
  - name: "Ship"
    concepts: [bundles-overview, bundles-variables-targets, secrets-management, cli-and-sdk, bundles-ci-cd]
---

The longest path on the site and the one that maps almost one-to-one onto the [[de-associate|Data Engineer Associate]] exam. Work it in order: every stage assumes the one before it.

If you have never opened a Databricks workspace, do [[lakehouse-foundations|Lakehouse Foundations]] first.
