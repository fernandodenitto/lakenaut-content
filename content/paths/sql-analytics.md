---
id: sql-analytics
title: "SQL & Analytics"
tag: "warehouse & BI"
level: beginner
hours: 30
order: 5
icon: warehouse
summary: "Query the lakehouse from the SQL editor, model gold tables and views for BI, and understand what a SQL warehouse costs."
certs: []
stages:
  - name: "Foundations"
    concepts: [delta-lake-overview, unity-catalog-overview, sql-editor-basics, genie-code, sql-warehouse-sessions, sql-parameters-and-variables]
  - name: "Model for BI"
    concepts: [gold-layer-objects, medallion-architecture, metric-views, dashboard-data-modeling, uc-domains-and-pages, dashboard-filters-and-variables, dashboard-schedules-and-subscriptions]
  - name: "Query and serve"
    concepts: [sql-warehouse-sizing, query-profile, dashboards-overview, genie-agents, genie-knowledge-store, genie-benchmarks-monitoring, materialized-views-sql, genie-ontology, streaming-tables-sql, alerts-overview, genie-conversation-api, alert-compute-and-cost, sql-warehouse-types-and-channels, query-performance-insights, sql-query-caching, genie-agent-tuning, genie-one]
---

The analyst's half of the platform. You do not need to know Spark internals to be useful here, but you do need to know what a warehouse costs, why a query is slow, and which object to build for BI.

If you already run pipelines, jump straight to the Query and serve stage: the modelling concepts overlap with [[data-engineering|Data Engineering]].
