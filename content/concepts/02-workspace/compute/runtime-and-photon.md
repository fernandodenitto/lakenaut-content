---
id: runtime-and-photon
title: "Databricks Runtime and Photon"
area: compute
level: intermediate
summary: Databricks Runtime is the versioned Spark-plus-libraries bundle a classic cluster runs; Photon is its optional vectorized C++ engine for SQL and DataFrame work.
prerequisites: [compute-options, spark-tuning-basics]
related: [spark-ui-bottlenecks, query-profile, serverless-compute, cluster-policies]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/release-notes/runtime/
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/compute/photon
    checked: 2026-09-10
aliases: [DBR, databricks runtime, LTS, ML runtime, photon engine, vectorized engine]
updated: 2026-09-10
status: published
---

## What it is

Databricks Runtime is the versioned software image a classic cluster boots: an Apache Spark build, the JVM, OS packages, GPU drivers where relevant, and curated Python/Java libraries, all tested together. You pick a version — `16.4.x-scala2.12`, say — when configuring a cluster (see [[compute-options]]); serverless sidesteps the choice with its own versionless environment (see [[serverless-compute]]). **Photon** is a separate switch on top: a native engine replacing the JVM-based Spark SQL engine for the operators it supports.

## Why it exists

Without a runtime, "which Spark version, patched against which CVE" is a per-cluster question every team answers differently, and upgrading Spark means rebuilding a machine image by hand. Bundling it lets Databricks ship fixes on a schedule and lets you pick a support horizon — short-lived for the latest features, long-lived for a job you don't want to touch every quarter.

## How it works

### LTS vs current

Each runtime maps to one Spark version (16.4 LTS → Spark 3.5, 17.x → Spark 4.0, and so on). **LTS** releases get an extended window, around three years, with security and bug fixes but no breaking changes — the right default for production. **Current** (non-LTS) releases move faster and pick up features sooner, but their window is shorter and ends once the next LTS supersedes them; treat them as an evaluation target, not a place to leave unattended jobs for years.

### The ML runtime

Databricks Runtime **for Machine Learning** adds a pinned, pre-tested ML/DL stack (MLflow, Feature Engineering client, GPU drivers on the GPU variant) so a training job doesn't spend ten minutes resolving pip conflicts. Its version tracks the standard runtime it's built from. Use it for training and batch scoring; a plain ETL job doesn't need the weight.

### What changes between major versions

The visible change is the Spark major version plus whatever the migration guide lists as breaking (parsing changes, deprecated defaults, removed APIs). Underneath, library versions move too — pandas, numpy, the Delta client — and an upgrade is the moment a notebook pinned to "whatever ships" quietly starts behaving differently. Read the release notes before a bulk upgrade, not just the version number.

### Photon: what it speeds up

Photon is a vectorized engine written in C++ that processes data in columnar batches instead of Spark's row-at-a-time JVM execution. It accelerates SQL and DataFrame queries — scans with filter pushdown, hash joins, hash aggregations, window functions, Parquet/Delta writes — on SQL warehouses, clusters, and serverless alike, on by default with no toggle. It falls back transparently to regular Spark for anything it doesn't implement: UDFs, RDD/Dataset APIs, and stateful streaming.

### How to tell it's running

In the **Spark UI**, Photon operators in a query's DAG render in orange, non-Photon ones in blue. In the **query profile** (the serverless equivalent, see [[query-profile]]), the same split shows as purple versus grey nodes, plus a percentage of task time spent inside Photon — a mostly-grey query is one where a UDF or unsupported operator does most of the work, and Photon isn't the lever to pull.

### The cost trade-off

A Photon instance consumes DBUs at a higher rate than the same instance without it — the wrong number to compare in isolation. Photon workloads typically finish faster, so total cost — rate times duration — is usually lower despite the sticker shock on the hourly rate. It stops paying off on workloads that are mostly UDFs or RDDs, where the higher rate applies to time Photon isn't accelerating.

## Example

A job cluster with LTS and Photon spelled out rather than implied:

```yaml
resources:
  jobs:
    monthly_reconciliation:
      job_clusters:
        - job_cluster_key: main
          new_cluster:
            spark_version: "16.4.x-photon-scala2.12"
            num_workers: 6
```

```sql
-- confirming Photon covered the expensive part
EXPLAIN FORMATTED
SELECT customer_id, sum(amount) FROM silver.transactions GROUP BY customer_id;
-- "PhotonGroupingAgg" / "PhotonShuffleExchangeSink" in the plan means
-- the aggregation and shuffle ran in Photon, not the JVM path
```

## Common mistakes

- Pinning a production job to a non-LTS runtime because it was newest in the dropdown, then losing patch support months later.
- Assuming Photon speeds up a pipeline dominated by a Python UDF — check the query profile before crediting or blaming it.
- Comparing DBU-per-hour between Photon and non-Photon without also comparing run duration.
- Reaching for the ML runtime on a job that only reads and writes Delta tables — extra startup time, extra libraries, no benefit.
- Bulk-upgrading every job cluster to a new major version on release day without reading what changed for the workloads that matter.

> [!tip]
> If a query looks slow, check the query profile's Photon coverage before touching cluster size: a mostly-grey plan means more workers won't help — the fix is in the query or the UDF, not the compute.
