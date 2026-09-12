---
id: dashboard-filters-and-variables
title: Dashboard filters, parameters and variables
area: dashboards
level: intermediate
summary: "The four ways a dashboard becomes interactive: field filters, query parameters, dashboard variables, and click-driven cross-filtering and drill-through."
prerequisites: [dashboards-overview]
related: [dashboard-data-modeling, dashboard-schedules-and-subscriptions, metric-views, sql-editor-basics]
exams:
  - cert: data-analyst-associate
    domain: "Working with Dashboards and Visualizations in Databricks"
    objective: "Work with parameters in SQL queries and dashboards, including defining, configuring, and testing parameters."
sources:
  - url: https://docs.databricks.com/aws/en/dashboards/manage/filters/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/dashboards/manage/filters/parameters
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/dashboards/manage/filters/dashboard-variables
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/dashboards/manage/filter-types
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/dashboards/limits
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/ai-bi/release-notes/2026
    checked: 2026-09-12
aliases: [dashboard filter, field filter, dashboard parameter, query-based parameter, dashboard variable, cross-filtering, drill-through, IDENTIFIER clause, named parameter marker, static widget parameter]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

An [[dashboards-overview|AI/BI dashboard]] becomes interactive through four mechanisms, operating at different layers:

| Mechanism | What it changes | Where the work happens |
| --- | --- | --- |
| **Field filter** | which rows of an already-resolved dataset a widget shows | in the browser for small datasets, otherwise re-runs the dataset query with the predicate applied |
| **Parameter** | a value substituted into the dataset SQL at run time | always on the SQL warehouse, because the query text changes |
| **Dashboard variable** | which *field* a visualisation encodes | in the dashboard layer, no query change |
| **Cross-filtering and drill-through** | filters derived from clicking a mark | the same path as a field filter |

The first two answer the same need at different costs, the third answers a different need, and the fourth is what viewers reach for without being taught.

## Why it exists

The alternative is one dashboard per slice: a copy for EMEA, a copy for last quarter, a copy with revenue on the y-axis instead of transactions, each drifting from the others the moment somebody fixes a calculation in one of them. Parameters and field filters both collapse that into one artefact, and the reason both exist is performance. A field filter is applied to the resolved result of a dataset, so it can only filter at the end. A parameter rewrites the query, so the predicate can go anywhere, including before a join, where it cuts the volume the join has to process. That difference is the whole of the field-against-parameter decision.

## How it works

### Scope

**Global filters** apply across every page to any visualisation sharing a dataset, and viewers can change them; **page-level filters** do the same for one page. **Widget-level filters** are static, fixed by the author, which is how two charts on the same dataset show different slices side by side. **Drill-through** is the fourth scope and is navigation rather than a widget. Everything currently applied, cross-filter selections and inherited defaults included, shows in the **active filter bar**.

### Field filter or parameter

Six filter types exist: single value, multiple values, date picker, date range picker, text entry and range slider. Fields support all six, parameters the first four. One widget can target fields, parameters, or both.

| | Field filter | Parameter |
| --- | --- | --- |
| Applied | to the resolved dataset, wrapped in a CTE at the end of the query | substituted into the query text at run time |
| Cost | often faster, and free for small datasets filtered in the browser | always re-runs the query |
| Reach | resolved columns only, never a subquery or conditional logic | anywhere in the query, including before a join |
| Cascading | on by default, so other filters narrow to compatible values | not available |

"Small" is a documented threshold: at or under 100,000 rows or 100 MB the result is pulled to the client and filtered there, so only the dataset query appears in query history. Above it the query is wrapped in a `WITH` clause and filtered on the warehouse, where the visualisation query shows up in history too. A dropdown renders up to 100,000 distinct values, and a paste into a multiselect accepts 1,000 at a time.

### Parameters in the dataset query

Parameters use named parameter marker syntax, `:keyword`; Mustache-style parameters are not supported. Each has a type: `String` (the default), `Date`, `Date and Time`, or `Numeric`, with `Decimal` or `Integer` underneath. Three behaviours are worth learning as idioms, because getting them wrong gives a query that runs and returns the wrong rows:

- **Multiple selections** needs `array_contains` plus a null check, and the parameter must be marked **Allow multiple selections** so it is passed as an array; `array_contains` without that setting raises an error. *All* sets the parameter to null, so the `OR :parameter IS NULL` branch returns everything.
- **Date Range** and **Date and Time Range** create two parameters with `.min` and `.max` suffixes, used in a `BETWEEN`. Relative defaults are expressions such as `now-30d/d`, where `/d` rounds to the start of the day.
- **Static widget parameters** are set on a visualisation rather than a filter widget. Two references to one parameter resolving to different values in the same update give a conflicting-values error rather than a silent winner.

### A field filter against a parameter

A **query-based parameter** is one filter widget wired to both: **Fields** supplies the list of eligible values, **Parameters** says which parameter the chosen value goes into. The list comes from its own dataset, dynamic (`SELECT DISTINCT ...`, so new values appear on their own) or static (a hardcoded `VALUES` list). That is how a parameter gets a real dropdown instead of a free-text box, and the trap is that the list dataset is an ordinary dataset: build a chart on it and the viewer's selection filters that chart too.

### Dashboard variables

A **dashboard variable** groups several fields so a viewer can switch which one a visualisation encodes. The author adds the variable to an axis or a column and binds it to a control widget; every visualisation using that variable follows the selection. It needs `CAN EDIT` on the draft.

Variables replaced the old trick of swapping fields with the `IDENTIFIER` clause and a parameter. Unlike `IDENTIFIER`, they work with [[metric-views|metric views]] and keep the semantic formatting attached to each field, so switching from a currency measure to a count relabels and reformats correctly. Each field carries a **transform** (`SUM` for a measure, `DAILY` for a date), fixed at definition time and not overridable where the variable is used, and the first field is the default. The scale type is decided by the whole set, not by the current selection: all-numeric is quantitative, all-date temporal, anything mixed categorical only.

### Cross-filtering and drill-through

Both are generally available. **Cross-filtering** applies automatically to supported charts sharing a dataset: click a bar, a heatmap cell or a point and every other widget on that dataset narrows. Bar, box plot, heatmap, histogram, pie, scatter and point map support it, tables support row selection, and on a faceted chart the facet field joins the filter.

**Drill-through** is right-click, then **Drill to** a page. Visualisations on the target that use the same dataset filter themselves, and a filter there on that dataset is populated with the selection. It works on area, bar, box, combo, heatmap, histogram, line, pie, pivot table, scatter, point map and table. Two constraints bite: the source data type must match the target filter's type, and date fields need a transform such as `DAILY`, because matching is on exact values. Multi-selection across several dimensions is not yet supported.

> [!note]
> Two behaviours built on dashboard relationships are in **Public Preview** as of September 2026: **relationship-scoped filters**, where a widget responds only to filters whose dataset is related to it, and **cross-dataset filtering**, where a selection on one dataset carries to widgets on related datasets. Both need relationships, themselves in Public Preview (see [[dashboard-data-modeling]]), as is a custom visualisation acting as a cross-filter source. Read them to know they exist, not to build on.

A published dashboard encodes filter state in its URL, as `f_<page-name>~<widget-name>=<value>` with relative dates written literally (`now-12h`). That is what makes a filtered view bookmarkable, and what a [[dashboard-schedules-and-subscriptions|scheduled snapshot]] does not inherit unless you tell it to.

## Example: a parameter that filters before the join

The parameter sits inside the CTE, so the scan is cut before the join. A field filter cannot reach here.

```sql
-- Dataset: "Regional orders", parameters :region and :date_param
WITH scoped_orders AS (
  SELECT order_id, customer_id, order_date, net_revenue
  FROM sales.gold.orders_daily
  WHERE order_date BETWEEN :date_param.min AND :date_param.max
    AND (array_contains(:region, region) OR :region IS NULL)
)
SELECT c.segment, o.order_date, SUM(o.net_revenue) AS net_revenue
FROM scoped_orders o
JOIN sales.gold.customers c ON c.customer_id = o.customer_id
GROUP BY ALL;
```

`:region` is marked **Allow multiple selections**, so *All* passes null and every region comes back. `:date_param` is a Date Range, `.min` defaulting to `now-30d/d` and `.max` to `now/d`. The dedicated dataset behind its dropdown, used by no visualisation:

```sql
-- Dataset: "Region list", feeding the Fields side of the query-based parameter widget
SELECT DISTINCT region
FROM sales.gold.orders_daily
WHERE region <> 'TEST'
ORDER BY region;
```

## Common mistakes

- **Using a field filter when the predicate needs to run before a join.** It is wrapped in a CTE and applied at the end. On a large fact table that is the difference between a two-second chart and a twenty-second one.
- **Forgetting the `OR :parameter IS NULL` branch, or `array_contains` without Allow multiple selections.** The first silently returns nothing when a viewer picks *All*; the second errors out.
- **Building a query-based parameter on a dataset a chart also uses.** The viewer's dropdown choice then filters that chart as a side effect. Give the value list its own dataset.
- **Enabling drill-through on an untransformed datetime field.** Matching is by exact value, so a datetime on a categorical scale never matches the target filter.
- **Confusing a variable with a parameter.** A variable changes which field is displayed; a parameter changes a value inside the query. They are not alternatives.

> [!exam]
> The Data Analyst Associate guide asks you to define, configure and test parameters in SQL queries and dashboards. Know the `:keyword` syntax, that Mustache syntax is not supported, the four types, and the `.min`/`.max` pair a date range creates. The distinction that gets tested is field filter against parameter: a field filter is applied to resolved results and can run in the browser, a parameter rewrites the query and always re-runs it on the warehouse. Dashboard variables and drill-through postdate the October 2025 guide, so do not expect them by name.
