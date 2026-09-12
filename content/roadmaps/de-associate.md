---
id: de-associate
title: Data Engineer Associate
short: DE Associate
exam_guide_version: "2026-05"
exam_guide_url: https://www.databricks.com/sites/default/files/2026-05/databricks-certified-data-engineer-associate-exam-guide-may-2026-000.pdf
exam_page_url: https://www.databricks.com/learn/certification/data-engineer-associate
questions: 45
minutes: 90
summary: The entry-level certification for data engineering on Databricks. Ingestion, transformation, Lakeflow Jobs, CI/CD with bundles, troubleshooting, and governance with Unity Catalog.
prerequisite_tracks: [foundations-sql, foundations-python]
full_resources: []
domains:
  - name: "Databricks Intelligence Platform"
    weight: 6
    objectives:
      - "Platform components: architecture, Delta Lake, Unity Catalog"
      - "Compute services: characteristics, limits, cost model, choosing the right one for a workload"
    concepts: [platform-architecture, delta-lake-overview, unity-catalog-overview, compute-options, uc-metastore-and-setup, jobs-serverless]
  - name: "Data Ingestion and Loading"
    weight: 21
    objectives:
      - "Batch, streaming, and incremental ingestion patterns; sources: local files, standard connectors, and Lakeflow Connect managed connectors"
      - "COPY INTO to load files from object storage into Unity Catalog tables"
      - "Auto Loader with schema enforcement and evolution in batch mode (directory listing, file notification)"
      - "Lakeflow Connect for enterprise sources"
      - "JDBC/ODBC and REST clients from notebooks, orchestrated with Lakeflow Jobs"
      - "Choosing between Auto Loader, Lakeflow Connect, partner connectors, and other methods"
      - "Ingesting semi-structured and unstructured data (JSON, nested)"
    concepts: [ingestion-patterns, copy-into, auto-loader, lakeflow-connect, ingestion-jdbc-rest, semi-structured-data, kafka-streaming, streaming-tables-sql]
  - name: "Data Transformation and Modeling"
    weight: 22
    objectives:
      - "Cleaning data from bronze to silver with PySpark/SQL: nulls, types, writes"
      - "Joins (inner, left, broadcast, multiple keys, cross), union and union all"
      - "Manipulating columns, rows, and structure: add, drop, split, rename, filter, explode"
      - "Deduplication and aggregations: count, approx count distinct, mean, summary"
      - "Basic tuning parameters and performance measurement"
      - "Gold-layer objects: materialized views, views, streaming tables, tables"
      - "Quality checks and validation rules on silver and gold"
    concepts: [medallion-architecture, dataframe-joins-unions, dataframe-columns-rows, dataframe-dedup-aggregations, merge-upsert, spark-tuning-basics, gold-layer-objects, pipelines-expectations]
  - name: "Working with Lakeflow Jobs"
    weight: 16
    objectives:
      - "Control flow: retries, conditional tasks, branching, loops"
      - "Common tasks (notebook, SQL, dashboard, pipeline) and dependencies in the DAG"
      - "Scheduling and trigger types: scheduled, file arrival, table update"
      - "Time-based or data-driven triggers depending on data availability and dependencies"
    concepts: [jobs-overview, jobs-task-dependencies, jobs-control-flow, jobs-triggers, jobs-parameters, jobs-repair-runs, pipelines-overview, jobs-queue-and-concurrency]
  - name: "Implementing CI/CD"
    weight: 10
    objectives:
      - "Development workflow in the workspace: branch, commit, push, pull request with Git folders"
      - "Per-environment configuration with bundle variables and overrides"
      - "Deploying Declarative Automation Bundles for jobs, pipelines, and other assets across dev, test, and prod"
      - "Databricks CLI to validate, deploy, and manage bundles in CI/CD"
    concepts: [git-folders, bundles-overview, bundles-variables-targets, bundles-ci-cd]
  - name: "Troubleshooting, Monitoring, and Optimization"
    weight: 10
    objectives:
      - "Performance trends from job run history"
      - "Monitoring pipeline health from the UI: states, DAG graph, timings, failure rate"
      - "Bottlenecks (skew, shuffle, spill) from stage metrics in the Spark UI"
      - "Liquid Clustering and predictive optimization"
      - "Diagnosing failed cluster startup, library conflicts, out of memory"
    concepts: [runs-monitoring, spark-ui-bottlenecks, liquid-clustering, cluster-troubleshooting, system-tables, delta-optimize-vacuum, jobs-repair-runs, jobs-task-dependencies, predictive-optimization, data-layout-partitioning-zorder]
  - name: "Governance and Security"
    weight: 15
    objectives:
      - "Managed and external tables: differences and basic operations"
      - "GRANT, REVOKE, and DENY on principals at the right levels of the hierarchy"
      - "Column masking and row-level security"
      - "ABAC policies for centralized row filters and masks"
    concepts: [managed-vs-external-tables, privileges-grant-revoke, row-filters-column-masks, abac-policies, external-locations-and-storage-credentials, governed-tags, compute-access-modes]
---

## How to use this roadmap

The domains follow the order of the official exam guide (May 4, 2026 version). The weight tells you how many questions to expect: 45 questions in 90 minutes, so roughly 10 questions on ingestion and 7 on jobs.

Study advice: start with the heaviest domains (ingestion, transformation) and finish with governance, which is more about memorization. Jobs and CI/CD are the domains where hands-on practice matters more than reading: build a real job, break it, repair it.

> [!exam]
> The exam is multiple choice, closed book. Many questions are "pick the right tool" (Auto Loader or COPY INTO? serverless or job cluster? GRANT or DENY?). Every concept in this roadmap ends with a callout summarizing what gets asked.
