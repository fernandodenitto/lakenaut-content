---
id: data-analyst-associate
title: Data Analyst Associate
short: Data Analyst
exam_guide_version: "2025-10"
exam_guide_url: https://www.databricks.com/sites/default/files/2025-10/databricks-certified-data-analyst-associate-oct-2025.pdf
exam_page_url: https://www.databricks.com/learn/certification/data-analyst-associate
questions: 45
minutes: 90
summary: The entry-level certification for data analysis on Databricks. Querying and modeling data with Databricks SQL, building AI/BI dashboards and Genie Agents (the guide says Genie spaces), and applying basic data governance and security.
prerequisite_tracks: [foundations-sql, foundations-python]
full_resources: []
domains:
  - name: "Understanding of Databricks Data Intelligence Platform"
    objectives:
      - "Describe the core components of the Databricks Intelligence Platform, including Mosaic AI, Delta Live Tables, Lakeflow Jobs, Data Intelligence Engine, Delta Lake, Unity Catalog, and Databricks SQL."
      - "Understand catalogs, schemas, managed and external tables, access controls, views, certified tables, and lineage within the Catalog Explorer interface."
      - "Describe the role and features of Databricks Marketplace."
    concepts: [platform-architecture, unity-catalog-overview, managed-vs-external-tables]
  - name: "Managing Data"
    objectives:
      - "Use Unity Catalog to discover, query, and manage certified datasets."
      - "Use the Catalog Explorer to tag a data asset and view its lineage."
      - "Perform data cleaning on Unity Catalog tables in SQL, including removing invalid data or handling missing values."
    concepts: [unity-catalog-overview]
  - name: "Importing Data"
    objectives:
      - "Explain the approaches for bringing data into Databricks, covering ingestion from S3, data sharing with external systems via Delta Sharing, API-driven data intake, the Auto Loader feature, and Marketplace."
      - "Use the Databricks Workspace UI to upload a data file to the platform."
    concepts: [ingestion-patterns, auto-loader, copy-into]
  - name: "Executing queries using Databricks SQL and Databricks SQL Warehouses"
    objectives:
      - "Utilize Databricks Assistant within a Notebook or SQL Editor to facilitate query writing and debugging."
      - "Explain the role a SQL warehouse plays in query execution."
      - "Query cross-system analytics by joining data from a Delta table and a federated data source."
      - "Create a materialized view, including knowing when to use Streaming Tables and Materialized Views, and differentiate between dynamic and materialized views."
      - "Perform aggregate operations such as count, approximate count distinct, mean, and summary statistics."
      - "Write queries to combine tables using various join operations (inner, left, right, and so on) with single or multiple keys, as well as set operations like union and union all."
      - "Perform sorting and filtering operations on a table."
      - "Create managed tables and external tables, including creating tables by joining data from multiple sources (e.g., CSV, Parquet, Delta tables) to create unified datasets, including Unity Catalog."
      - "Use Delta Lake's time travel to access and query historical data versions."
    concepts: [sql-editor-basics, sql-warehouse-sizing, gold-layer-objects, dataframe-dedup-aggregations, sql-joins-and-sets, delta-time-travel, managed-vs-external-tables, materialized-views-sql, sql-warehouse-types-and-channels]
  - name: "Analyzing Queries"
    objectives:
      - "Understand the features, benefits, and supported workloads of Photon."
      - "Identify poorly performing queries in the Databricks Intelligence Platform, such as Query Insights and the Query Profiler log."
      - "Use Delta Lake to audit and view history, validate results, and compare historical results or trends."
      - "Use query history and caching to reduce development time and query latency."
      - "Apply Liquid Clustering to improve query speed when filtering large tables on specific columns."
      - "Fix a query to achieve the desired results."
    concepts: [query-profile, liquid-clustering, delta-time-travel, sql-query-caching, query-performance-insights]
  - name: "Working with Dashboards and Visualizations in Databricks"
    objectives:
      - "Build dashboards using AI/BI Dashboards, including multi-tab/page layouts, multiple data sources/datasets, and widgets (visualizations, text, images)."
      - "Create visualizations in notebooks and the SQL editor."
      - "Work with parameters in SQL queries and dashboards, including defining, configuring, and testing parameters."
      - "Configure permissions through the UI to share dashboards with workspace users/groups, external users through shareable links, and embed dashboards in external apps."
      - "Schedule an automatic dashboard refresh."
      - "Configure an alert with a desired threshold and destination."
      - "Identify the effective visualization type to communicate insights clearly."
    concepts: [dashboards-overview, alerts-overview, dashboard-schedules-and-subscriptions, dashboard-filters-and-variables, sql-parameters-and-variables]
  - name: "Developing, Sharing, and Maintaining AI/BI Genie spaces"
    objectives:
      - "Describe the purpose, key features, and components of AI/BI Genie spaces."
      - "Create Genie spaces by defining reasonable sample questions and domain-specific instructions, choosing SQL warehouses, curating Unity Catalog datasets (tables, views...), and vetting queries as Trusted Assets."
      - "Assign permissions via the UI and distribute Genie spaces using embedded links and external app integrations."
      - "Optimize AI/BI Genie spaces by tracking user questions, response accuracy, and feedback; updating instructions and trusted assets based on stakeholder input; validating accuracy with benchmarks; refreshing Unity Catalog metadata."
    concepts: [genie-agents, genie-knowledge-store, genie-benchmarks-monitoring, genie-conversation-api, genie-agent-tuning]
  - name: "Data Modeling with Databricks SQL"
    objectives:
      - "Apply industry-standard data modeling techniques, such as star, snowflake, and data vault schemas, to analytical workloads."
      - "Understand how industry-standard models align with the Medallion Architecture."
    concepts: [medallion-architecture, metric-views]
  - name: "Securing Data"
    objectives:
      - "Use Unity Catalog roles and sharing settings to ensure workspace objects are secure."
      - "Understand how the three-level namespace (Catalog / Schema / Tables or Volumes) works in the Unity Catalog."
      - "Apply best practices for storage and management to ensure data security, including table ownership and PII protection."
    concepts: [unity-catalog-overview, privileges-grant-revoke]
---

## How to use this roadmap

The nine domains above follow the order of the official exam guide (the version live as of October 30, 2025). Like the Professional guide, this version does not publish a percentage weight per domain — plan for roughly even coverage across sections instead of betting on one being heavier than the rest.

What makes this exam different from the engineering-focused associate track: most objectives are UI-driven rather than code-driven — building an AI/BI dashboard, configuring a Genie Agent, reading a query profile, tagging an asset in Catalog Explorer — so time spent in the SQL persona of the workspace matters as much as reading. The SQL itself stays basic: joins, aggregates, filtering, and views you already meet in the SQL foundations track. Genie Agents and several dashboard-specific objectives have no matching concept yet in this vault; they render as "still to write" below.

> [!exam]
> No domain weights are published for this exam guide version. Expect questions framed around a business scenario — "which visualization fits", "which alert configuration triggers" — more than raw SQL syntax questions.
