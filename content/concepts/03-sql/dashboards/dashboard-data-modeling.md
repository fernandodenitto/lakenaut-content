---
id: dashboard-data-modeling
title: Modelling data inside a dashboard
area: dashboards
level: intermediate
summary: "Four ways to shape data inside an AI/BI dashboard: datasets, custom calculations, local metric views and relationships, and when the logic should move to Unity Catalog."
prerequisites: [dashboards-overview]
related: [metric-views, gold-layer-objects, sql-joins-and-sets, sql-window-functions, genie-agents]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/dashboards/manage/data-modeling/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/dashboards/manage/data-modeling/local-metric-views
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/dashboards/manage/data-modeling/dashboard-relationships
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/dashboards/manage/data-modeling/custom-calculations
    checked: 2026-09-11
aliases: [custom calculations, calculated measure, calculated dimension, local metric view, dashboard relationships, AGGREGATE OVER, semantic model]
updated: 2026-09-11
status: published
maturity: ga
---

## What it is

Every visualisation in an [[dashboards-overview|AI/BI dashboard]] reads from a **dataset**. On top of datasets there are three further ways to shape data without duplicating logic, and choosing between them is the whole of dashboard modelling:

| Option | What it gives you | Status |
| --- | --- | --- |
| **SQL dataset** | a query against any source, the base every other option builds on | generally available |
| **Custom calculations** | extra measures and fields on one dataset, without touching its SQL | generally available |
| **Local metric view** | fields, measures and joins defined in the dashboard at a fixed grain, promotable to Unity Catalog | generally available |
| **Dashboard relationships** | a join graph across datasets, with reusable cross-dataset measures | Public Preview |

None of them creates a Unity Catalog object; all are scoped to one dashboard. The moment a definition has to be shared with another dashboard, a Genie Agent or an external BI tool, it belongs in a [[metric-views|Unity Catalog metric view]].

## Why it exists

The old answer to "I need revenue and shipping cost on the same chart" was to pre-join the fact tables in SQL, aggregate carefully to avoid fan-out, and save the result as another dataset. That join logic then lived in the dataset query, duplicated into every dataset that needed the same shape, and the next person who wanted a different grouping wrote a fourth one.

Dashboard-scoped modelling exists for the stage before the logic is settled: analysis specific to a small team, a definition still being argued about, or an author with no write access to a Unity Catalog schema. It gives that work a home with real semantic behaviour, and a one-click path out when it earns wider use.

## How it works

### Custom calculations

A custom calculation adds a field or a measure to one SQL dataset without editing its query, up to **200 per dataset**, of two kinds:

- **Calculated measures** are aggregates, such as `(SUM(price) - SUM(cost)) / SUM(price)`. They re-evaluate against whatever the chart groups by, so one definition serves margin by region and margin by item.
- **Calculated dimensions** are unaggregated: a `CASE` bucketing ages, a `CONCAT`, a date format.

Windowed results come from two operators. `OVER` is a scalar window function with its own `PARTITION BY`, evaluated before any visualisation grouping, and it ignores the chart's groupings entirely. `AGGREGATE OVER` inherits its partitions from the visualisation, respects its filters, and takes a frame such as `TRAILING 7 DAY INCLUSIVE`, `CUMULATIVE` or `ALL`, with an optional `OFFSET`. Use `OVER` for ranking functions and fixed levels of detail, `AGGREGATE OVER` for moving windows that should follow the chart.

Calculations can reference other calculations in the same dataset, with no circular references, and can read parameters with the `:name` syntax. They cannot reach outside their own dataset. Up to 100,000 rows and 100 MB the calculation runs in the browser; anything larger goes to the SQL warehouse. Adding custom calculations on top of a metric view dataset is itself in Public Preview.

### Local metric views

A local metric view is the [[metric-views|metric view]] editor, and the same YAML, stored inside the dashboard rather than in Unity Catalog. It keeps the semantic behaviour that matters: measures with no baked-in grain, aggregation resolved at query time, joins declared once. The only requirement is `CAN USE` on a SQL warehouse, which is the point for authors without catalog write access.

You can build one from one or more tables, or by **extending an existing Unity Catalog metric view** with dashboard-specific measures and fields; read-only access to the base is enough. `cluster_by` and `partition_by` work in the `materialization` block, as on any metric view.

Three limitations matter before you commit: no `IDENTIFIER` parameters, no SQL containing `GRANT` statements, and no way to convert an existing SQL dataset into a local metric view. The last one makes this choice easier to get right up front than to reverse.

When the logic is ready, **Export to Metric View** from the dataset's kebab menu writes it to a catalog and schema you choose, and it becomes a normal Unity Catalog metric view.

### Dashboard relationships

Relationships declare how two datasets join: a field in each, plus a cardinality. The datasets form a graph, and the engine resolves whichever joins a visualisation needs at query time. No pre-joining, no fan-out, no duplicated SQL.

Two shapes are supported: a **snowflake** chain of dimensions, and **shared (conformed) dimensions** where several fact tables meet at the same dimension. Two are not: an **ambiguous join path**, where a fact table reaches one dimension by two routes, and a **cyclic relationship**, a closed loop of joins. Both are fixed by aliasing a table so each route has its own node in the graph.

Because fact tables meet at shared dimensions, you can define a **cross-dataset measure** at model level that spans them, such as `SUM(Orders.revenue) - SUM(Returns.refund)`. Each fact table is aggregated independently and the results are combined at the shared dimension.

The behaviour that surprises people is the **root**: the first field you add to a visualisation sets the table everything else resolves against. From the root, fields reach through any many-to-one chain and measures aggregate independently, but a **raw unaggregated column** on a non-root fact table is unreachable. Start from order revenue and you can add customer region and shipment cost, but not ship mode; start from ship mode and the root flips.

### Relationships against metric views

Both model a join graph; the difference is grain. A metric view is **fixed grain**, with the root baked in at definition time, so every query groups by that dimension. Dashboard relationships are **dynamic grain**, with the root chosen per query. So relationships suit multi-fact, multi-grain analysis and metric views suit a single governed star or snowflake, and a relationship graph can use metric views as its nodes. Support for relationships in Unity Catalog itself is still in progress.

Databricks recommends local metric views over custom calculations for anything you expect to reuse or refine, keeping custom calculations for lightweight metrics scoped to one dataset.

## Example: profit margin, two ways

As custom calculations on a SQL dataset, written in the calculation editor rather than in the dataset query:

```sql
-- Calculated measure "Profit margin"
(SUM(price) - SUM(cost)) / SUM(price)

-- Calculated measure "Margin, trailing 7 days", following the chart's groupings
(
  (SUM(price) - SUM(cost)) / SUM(price)
) AGGREGATE OVER (
  ORDER BY order_date TRAILING 7 DAY INCLUSIVE
)
```

The same logic as a local metric view, which is what you want once a second chart needs it:

```yaml
version: 1.1
source: sales.gold.orders_enriched

fields:
  - name: order_date
    expr: order_date
  - name: region
    expr: region

measures:
  - name: profit_margin
    expr: (SUM(price) - SUM(cost)) / SUM(price)
    display_name: 'Profit Margin'
    comment: 'Gross margin on list price, before discounts'
    synonyms: ['margin', 'gross margin']
```

Once the definition stops changing, export it to Unity Catalog so every consumer gets the same number.

## Common mistakes

- **Reaching for a custom calculation for logic you will reuse.** It is scoped to one dataset, and you cannot convert that dataset into a local metric view later.
- **Referencing a column from another dataset in a custom calculation.** Every column has to belong to the same dataset; expressions that reach outside it fail or return something unexpected.
- **Building a relationship graph with two routes to the same dimension.** The engine has no way to choose. Alias the dimension once per route rather than adding another relationship.
- **Blaming a missing field when the root is wrong.** A raw column on a non-root fact table is unreachable. Add a field from that table first and the root moves.
- **Mixing up `OVER` and `AGGREGATE OVER`.** `OVER` ignores the visualisation's groupings and filters; `AGGREGATE OVER` inherits them. The wrong one gives a chart that looks plausible and is wrong.
- **Keeping a metric local once several teams depend on it.** A local metric view is invisible to Genie Agents, other dashboards and external BI tools.

> [!tip]
> The October 2025 Data Analyst Associate guide covers datasets and building dashboards from multiple data sources, but predates local metric views and dashboard relationships, so do not expect them by name. The decision behind them is worth internalising anyway: dashboard-scoped for prototyping, Unity Catalog for anything governed and shared.
