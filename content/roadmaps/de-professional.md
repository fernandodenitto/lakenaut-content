---
id: de-professional
title: Data Engineer Professional
short: DE Professional
exam_guide_version: "2026-07"
exam_guide_url: https://www.databricks.com/sites/default/files/2026-07/databricks-certified-data-engineer-professional-exam-guide-july-3-2026.pdf
exam_page_url: https://www.databricks.com/learn/certification/data-engineer-professional
questions: 59
minutes: 120
summary: The advanced certification for production data engineering on Databricks. ETL pipeline design, streaming, governance, security, and cost and performance optimization, plus CI/CD with Declarative Automation Bundles.
prerequisite_tracks: [foundations-sql, foundations-python]
full_resources: []
domains:
  - name: "Developing Code for Data Processing using Python and SQL"
    objectives:
      - "Design and implement a scalable Python project structure optimized for Declarative Automation Bundles (formerly Databricks Asset Bundles / DABs), enabling modular development, deployment automation, and CI/CD integration."
      - "Manage and troubleshoot external third-party library installations and dependencies in Databricks, including PyPI packages, local wheels, and source archives."
      - "Develop User-Defined Functions (UDFs) using Pandas/Python UDF."
      - "Build and manage reliable, production-ready data pipelines for batch and streaming data using Lakeflow Spark Declarative Pipelines and Auto Loader."
      - "Create and automate ETL workloads using Jobs via UI/APIs/CLI."
      - "Explain the advantages and disadvantages of streaming tables compared to materialized views."
      - "Use AUTO CDC APIs (formerly APPLY CHANGES) to simplify CDC in Lakeflow Spark Declarative Pipelines."
      - "Compare Spark Structured Streaming and Lakeflow Spark Declarative Pipelines to determine the optimal approach for building scalable ETL pipelines."
      - "Create a pipeline component that uses control flow operators (e.g., if/else, for/each, etc.)."
      - "Choose the appropriate configs for environments and dependencies, high memory for notebook tasks, and auto-optimization to disallow retries."
      - "Develop unit and integration tests using assertDataFrameEqual, assertSchemaEqual, DataFrame.transform, and testing frameworks, to ensure code correctness, including a built-in debugger."
    concepts: [bundles-overview, pipelines-overview, pipelines-auto-cdc, auto-loader, structured-streaming-basics, gold-layer-objects, jobs-overview, pipelines-sql-vs-python]
  - name: "Data Ingestion & Acquisition"
    objectives:
      - "Design and implement data ingestion pipelines to efficiently ingest a variety of data formats including Delta Lake, Parquet, ORC, AVRO, JSON, CSV, XML, Text, and Binary from diverse sources such as message buses and cloud storage."
      - "Create an append-only data pipeline capable of handling both batch and streaming data using Delta."
    concepts: [ingestion-patterns, semi-structured-data, auto-loader, copy-into, lakeflow-connect]
  - name: "Data Transformation, Cleansing, and Quality"
    objectives:
      - "Write efficient Spark SQL and PySpark code to apply advanced data transformations, including window functions, joins, and aggregations, to manipulate and analyze large datasets."
      - "Develop a quarantining process for bad data with Lakeflow Spark Declarative Pipelines, or Auto Loader in classic jobs."
    concepts: [sql-window-functions, sql-joins-and-sets, dataframe-dedup-aggregations, pipelines-expectations]
  - name: "Data Sharing and Federation"
    objectives:
      - "Demonstrate delta sharing securely between Databricks deployments using Databricks-to-Databricks Sharing (D2D) or to external platforms using the open sharing protocol (D2O)."
      - "Configure Lakehouse Federation with proper governance across the supported source systems."
      - "Use Delta Share to share live data from the lakehouse to any computing platform."
    concepts: [marketplace-delta-sharing, opensharing-overview, lakehouse-federation]
  - name: "Monitoring and Alerting"
    objectives:
      - "Use system tables for observability over resource utilization, cost, auditing, and workload monitoring."
      - "Use Query Profiler UI and Spark UI to monitor workloads."
      - "Use the Databricks REST APIs/Databricks CLI for monitoring jobs and pipelines."
      - "Use Lakeflow Spark Declarative Pipelines event logs to monitor pipelines."
      - "Use SQL Alerts to monitor data quality."
      - "Use the Lakeflow Jobs UI and Jobs API to set up notifications for job status and performance issues."
    concepts: [runs-monitoring, query-profile, spark-ui-bottlenecks, alerts-overview, pipelines-event-log]
  - name: "Cost & Performance Optimization"
    objectives:
      - "Understand how and why using Unity Catalog managed tables reduces operational overhead and maintenance burden."
      - "Understand Delta optimization techniques, such as deletion vectors and liquid clustering."
      - "Understand the optimization techniques used by Databricks to ensure the performance of queries on large datasets (data skipping, file pruning, etc.)."
      - "Apply Change Data Feed (CDF) to address specific limitations of streaming tables and enhance latency."
      - "Use the query profile to analyze a query and identify bottlenecks, such as bad data skipping, inefficient join types, and data shuffling."
    concepts: [managed-vs-external-tables, delta-optimize-vacuum, liquid-clustering, change-data-feed, query-profile, cost-attribution-and-budgets, predictive-optimization, deletion-vectors]
  - name: "Ensuring Data Security and Compliance"
    objectives:
      - "Use ACLs to secure workspace objects, enforcing the principle of least privilege and policy enforcement."
      - "Use row filters and column masks to filter and mask sensitive table data."
      - "Apply anonymization and pseudonymization methods, such as hashing, tokenization, suppression, and generalization, to confidential data."
      - "Implement a compliant batch and streaming pipeline that detects and applies masking of PII to ensure data privacy."
      - "Develop a data purging solution ensuring compliance with data retention policies."
    concepts: [privileges-grant-revoke, row-filters-column-masks, abac-policies]
  - name: "Data Governance"
    objectives:
      - "Create and add descriptions/metadata about enterprise data to make it more discoverable."
      - "Demonstrate understanding of the Unity Catalog permission inheritance model."
    concepts: [unity-catalog-overview, privileges-grant-revoke]
  - name: "Debugging and Deploying"
    objectives:
      - "Identify pertinent diagnostic information using Spark UI, cluster logs, system tables, and query profiles to troubleshoot errors."
      - "Analyze errors and remediate failed job runs with job repairs and parameter overrides."
      - "Use Lakeflow Spark Declarative Pipelines event logs and the Spark UI to debug pipelines and Spark jobs."
      - "Build and deploy Databricks resources using Declarative Automation Bundles (formerly Databricks Asset Bundles)."
      - "Configure and integrate Git-based CI/CD workflows with Databricks Git folders (formerly Repos) for notebook and code deployment."
    concepts: [cluster-troubleshooting, spark-ui-bottlenecks, jobs-repair-runs, bundles-overview, git-folders]
  - name: "Data Modeling"
    objectives:
      - "Design and implement scalable data models using Delta Lake to manage large datasets."
      - "Simplify data layout decisions and optimize query performance using Liquid Clustering."
      - "Identify the benefits of using Liquid Clustering over partitioning and Z-Order."
      - "Design dimensional models for analytical workloads, ensuring efficient querying and aggregation."
    concepts: [liquid-clustering, medallion-architecture, data-layout-partitioning-zorder]
---

## How to use this roadmap

The ten domains above follow the order of the official exam guide (the version live as of July 3, 2026). Unlike the Associate-level guide, this version does not publish a percentage weight per domain — only the list of sections and objectives, in the order shown. Treat every domain as roughly equally likely rather than betting on a "heavy" one, and use the objective bullets, not the domain order, to judge how deep to go.

What makes this exam harder than the Associate track: it assumes production experience, not just familiarity. Expect scenario questions about SLA-driven trigger choices, CI/CD with Declarative Automation Bundles, PII-masking pipelines, and picking between Auto CDC, Structured Streaming, and Lakeflow pipelines for the same problem, often with more than one technically valid answer where you must pick the best one. Where a node below says "still to write", the concept is planned rather than missing on purpose: the roadmap maps the whole guide, including the parts we have not reached yet.

> [!exam]
> No domain weights are published for this exam guide version. Study every section, and expect multi-step scenario questions built around a production incident rather than single-fact recall.
