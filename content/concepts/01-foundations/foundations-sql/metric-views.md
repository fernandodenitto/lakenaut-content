---
id: metric-views
title: Metric views
area: foundations-sql
level: intermediate
summary: A metric view is a Unity Catalog object whose body is YAML. It defines measures once, and every query picks its own grouping and reads the measures with MEASURE().
prerequisites: [spark-sql-basics, unity-catalog-overview]
related: [gold-layer-objects, dashboard-data-modeling, genie-knowledge-store, sql-joins-and-sets, dashboards-overview]
exams:
  - cert: data-analyst-associate
    domain: "Data Modeling with Databricks SQL"
    objective: "Apply industry-standard data modeling techniques, such as star, snowflake, and data vault schemas, to analytical workloads."
sources:
  - url: https://docs.databricks.com/aws/en/uc-semantics/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/uc-semantics/metric-views/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/uc-semantics/metric-views/create
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/uc-semantics/metric-views/yaml-reference
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/uc-semantics/metric-views/query
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/uc-semantics/metric-views/feature-availability
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/uc-semantics/metric-views/manage
    checked: 2026-09-11
aliases: [metric view, WITH METRICS, LANGUAGE YAML, MEASURE, semantic layer, semantic model, unity catalog semantics]
updated: 2026-09-11
status: published
maturity: ga
---

## What it is

A **metric view** is a Unity Catalog securable whose definition is a YAML document rather than a `SELECT`. The YAML names a **source**, optional **joins** and a **filter**, then two lists: **fields** (scalar expressions you group and filter by) and **measures** (aggregate expressions with no fixed grain). You create it with `CREATE VIEW <name> WITH METRICS LANGUAGE YAML AS $$ … $$`, or from the Catalog Explorer editor, which writes the same YAML for you.

The point is the split. A standard view bakes its `GROUP BY` into the query text; a metric view leaves the grouping to whoever queries it. Revenue is declared once as `SUM(o_totalprice)`, and the same object answers revenue by month, by market segment, or by both, computed correctly each time.

Metric views are the core of **Unity Catalog semantics**, the set of features that also includes domains, Pages and asset certification. They are the modelled half of what Genie reads as context (see [[genie-ontology]]).

## Why it exists

Without a semantic layer, a business metric lives in as many places as it has consumers. The dashboard has `SUM(revenue) - SUM(refunds)`, the weekly Python notebook forgot the refunds, the Genie Agent guesses from column names, and Power BI has its own copy. Nobody is wrong on purpose; there is just no object that owns the definition.

The alternative people reached for before was a wall of pre-aggregated gold tables: `revenue_by_region`, `revenue_by_month`, `revenue_by_region_and_month`. Each one is another thing to refresh, and the first analyst who needs a grouping nobody anticipated is stuck. A metric view moves the aggregation to query time and keeps one definition per metric.

## How it works

### The YAML document

| Key | Required | What it holds |
| --- | --- | --- |
| `version` | yes | the specification version, `0.1` or `1.1`. Not your own revision number |
| `comment` | no | description stored in Unity Catalog |
| `source` | yes | a three-part name of any table-like asset, another metric view, or a SQL query written inline |
| `filter` | no | a boolean SQL expression applied to every query against the view |
| `joins` | no | star and snowflake joins, each with `name`, `source` and `on` or `using` |
| `fields` | conditional | scalar expressions. `dimensions` is accepted as a synonym |
| `measures` | conditional | aggregate expressions, read with `MEASURE()` |
| `parameters` | no | named values passed at query time, which makes the view a table-valued function |
| `materialization` | no | pre-computed materialized views the engine rewrites queries onto |

At least one of `fields` and `measures` must be present. The low-code editor labels the column list **Fields** but writes `dimensions:` in the YAML, so both spellings turn up in real definitions.

### Joins

A join defaults to `cardinality: many_to_one`, the fact-to-dimension case, and the engine only joins the tables a given query actually touches. `source.<column>` refers to the source table, and a bare column in an `on` clause resolves against the joined table. Nesting `joins` inside a join gives you a snowflake schema. Setting `cardinality: one_to_many` treats the joined table as a second fact source aggregated at its own grain, which is how you count orders per customer without fanning the customer rows out.

`rely: {at_most_one_match: true}` is a promise to the optimizer that a join never fans out. It is not checked at runtime, so if it is wrong your sums quietly come back too large.

### Querying with MEASURE()

Every measure has to be wrapped in `MEASURE()`; `agg()` is an accepted alias on Databricks Runtime 18.1 and above. Because measures need that wrapper, `SELECT *` does not work: list the fields and wrap each measure.

Metric views also cannot be joined to a table directly. Aggregate the metric view inside a CTE first, then join the CTE result.

### Who reads them

The same object serves the SQL editor, notebooks, AI/BI dashboards, Genie Agents, alerts, JDBC and ODBC clients, and external BI tools such as Power BI, Tableau and Sigma. In dashboards, `MEASURE()` is applied for you and the agent metadata shows up in the UI. That metadata (`display_name`, `format`, and up to 10 `synonyms` per field or measure, each at most 255 characters) is what makes a metric view useful to a Genie Agent, which imports the synonyms directly (see [[genie-knowledge-store]]).

### Runtime requirements

Metric views arrived in Databricks Runtime 16.4, and the later features each have their own floor. A SQL warehouse always tracks the current Databricks SQL version, so this table matters mostly for clusters.

| Runtime | Adds |
| --- | --- |
| 17.3 | snowflake joins, agent metadata (YAML 1.1), `TEMPORARY` metric views, materialization, JDBC/ODBC through the Thrift server |
| 18.0 | BI compatibility mode, `REFRESH MATERIALIZED VIEW` |
| 18.1 | one-to-many joins, window `offset`, `inclusive`/`exclusive` on window ranges, `rely.at_most_one_match` |
| 18.2 | `parameters`, wildcard expressions in `fields` and `measures` |

Creating one needs `SELECT` on the source, plus `CREATE TABLE` and `USE SCHEMA` on the target schema and `USE CATALOG` on its catalog. After that it behaves like any other view: consumers need `SELECT` on the metric view, and only the owner can edit the definition. Transfer ownership to a group if more than one person should maintain it.

## Example: orders KPIs

```sql
CREATE OR REPLACE VIEW sales.gold.orders_metrics WITH METRICS LANGUAGE YAML AS
$$
version: 1.1
comment: "Order KPIs for sales analysis"
source: samples.tpch.orders

joins:
  - name: customer
    source: samples.tpch.customer
    'on': source.o_custkey = customer.c_custkey
    rely:
      at_most_one_match: true

filter: source.o_orderdate > '1990-01-01'

fields:
  - name: order_month
    expr: DATE_TRUNC('MONTH', source.o_orderdate)
    display_name: 'Order Month'
  - name: market_segment
    expr: customer.c_mktsegment
    comment: 'Customer market segment'

measures:
  - name: total_revenue
    expr: SUM(source.o_totalprice)
    synonyms: ['revenue', 'total sales']
  - name: revenue_per_customer
    expr: SUM(source.o_totalprice) / COUNT(DISTINCT source.o_custkey)
    synonyms: ['AOV', 'average order value']
$$;
```

Two different questions, one definition, no new object:

```sql
SELECT order_month, MEASURE(total_revenue)
FROM sales.gold.orders_metrics
GROUP BY ALL
ORDER BY order_month;

SELECT market_segment, MEASURE(revenue_per_customer)
FROM sales.gold.orders_metrics
GROUP BY ALL;
```

To join the result to another table, aggregate first:

```sql
WITH m AS (
  SELECT market_segment, MEASURE(total_revenue) AS revenue
  FROM sales.gold.orders_metrics
  GROUP BY market_segment
)
SELECT m.market_segment, m.revenue, t.target
FROM m JOIN sales.gold.segment_targets t USING (market_segment);
```

## Common mistakes

- **Writing `SELECT *` against a metric view.** Measures have no value until `MEASURE()` evaluates them, so the star form is rejected. List the fields and wrap each measure.
- **Setting `at_most_one_match: true` on a join that fans out.** Nothing validates the claim, and `SUM` and `COUNT` come back inflated. Use it only when the dimension truly has one matching row.
- **Joining a metric view to a table in the same query.** Not supported. Aggregate the metric view in a CTE, then join the CTE.
- **Creating a second metric view for a new grouping.** That recreates the problem metric views exist to remove. Add the field to the existing definition instead.
- **Leaving a colon unquoted in an expression.** YAML reads `Enterprise: Premium` as a key and a value. Wrap any expression containing a colon in double quotes, and use `|` for multi-line expressions.
- **Skipping `display_name`, `comment` and `synonyms`.** They are optional for a human reading SQL and close to essential for the dashboards and Genie Agents that consume the view.

> [!exam]
> The October 2025 Data Analyst Associate guide does not name metric views, so expect them under the modelling objective rather than as a topic of their own: they are the platform-native way to hold a star or snowflake model with governed measures. Know the vocabulary that a question would use: a metric view is a Unity Catalog object created with `CREATE VIEW … WITH METRICS LANGUAGE YAML`, its YAML has `source`, `joins`, `filter`, `fields` (formerly and still `dimensions`) and `measures`, and every measure is read with `MEASURE()`. The distinction that catches people out is fields against measures: a field is scalar and groupable, a measure carries no grain until the query supplies one.
