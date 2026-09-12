---
id: dashboards-overview
title: AI/BI dashboards
area: dashboards
level: beginner
summary: AI/BI dashboards turn datasets built on governed tables into shareable visualizations, refreshed on a schedule or as a job task.
prerequisites: [gold-layer-objects, unity-catalog-overview]
related: [sql-editor-basics, genie-agents, jobs-overview, runs-monitoring]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/dashboards/
    checked: 2026-09-10
aliases: [ai/bi dashboard, lakeview dashboard, dashboard, published dashboard]
updated: 2026-09-10
status: published
---

## What it is

An **AI/BI dashboard** is a collection of visualizations built on top of **datasets** — saved queries against Unity Catalog tables and views — arranged on one or more pages, with shared filters and parameters. It is the built-in BI layer of the workspace: no separate BI tool required to chart a gold table and share it.

## Why it exists

Most consumers of a report don't want to write SQL or open a notebook; they want a chart that refreshes and a link they can bookmark. Dashboards give the SQL/gold layer (see [[gold-layer-objects]]) a presentation surface, with authoring assisted by AI (natural-language-to-chart suggestions) so building one doesn't require deep BI tooling experience.

## How it works

### Datasets and visualizations

Each **dataset** is a query — written by hand or generated with AI assistance — that becomes reusable across several charts. **Visualizations** are built on a dataset, either through manual configuration or AI-assisted authoring that proposes a chart type from a natural-language description of what to show.

### Filters and parameters

Filters can be scoped globally to the whole dashboard, to one page, or to a single widget, and support cross-filtering (clicking a value in one chart filters the others). Parameters let a viewer change a value — a date range, a region — that feeds into the underlying dataset queries, so one dashboard serves many slices of the same data instead of duplicating datasets per slice.

### Draft vs. published, and the credentials question

A dashboard is edited as a **draft**; only a **published** dashboard is the shareable, viewer-facing version. Publishing asks a real governance question: whether to **embed the publisher's credentials**. With embedded credentials (the default), every viewer's queries run as the publisher, so people who lack direct access to the underlying tables can still see the dashboard — convenient, but it means the dashboard, not Unity Catalog, is now the access boundary. Without embedded credentials, each viewer's own Unity Catalog permissions apply, and someone lacking access to a table sees nothing where that data would be.

### Scheduling and subscriptions

A published dashboard can be set to refresh its datasets on a schedule, and viewers can subscribe to receive a snapshot by email or Slack on that same cadence, without opening the workspace.

### The dashboard task in a job

A dashboard refresh can also be a **task** in a Lakeflow job, so it runs right after the pipeline that feeds its tables finishes — see [[jobs-overview]] — instead of on an independent clock that might run before or after the data lands.

## Example

The dataset behind a chart is an ordinary SQL query:

```sql
SELECT region, DATE_TRUNC('week', order_date) AS week, SUM(amount) AS revenue
FROM sales.gold.orders
GROUP BY region, week;
```

Refreshing the dashboard as the last task of the job that builds `sales.gold.orders`:

```yaml
resources:
  jobs:
    sales_pipeline:
      name: sales-pipeline
      tasks:
        - task_key: build_gold_orders
          # ... pipeline or SQL task that writes sales.gold.orders
        - task_key: refresh_sales_dashboard
          depends_on:
            - task_key: build_gold_orders
          dashboard_task:
            dashboard_id: ${var.sales_dashboard_id}
```

## Common mistakes

- Publishing with embedded credentials without realizing viewers now see whatever the publisher can see, not what they themselves are entitled to.
- Assuming a **draft** is already shared just because it was saved — only publishing makes it visible to the intended audience.
- Scheduling a refresh on a small warehouse that then queues behind interactive traffic; see [[sql-warehouse-sizing]].
- Building one dataset per filter value instead of one parameterized dataset, multiplying maintenance for no benefit.
- Relying on a dashboard as the only signal that a pipeline succeeded, instead of checking run status directly — see [[runs-monitoring]].

> [!tip]
> Decide the credentials model at publish time, not after sharing the link: switching from embedded to viewer credentials later can silently blank out a dashboard for people who never had direct table access.
