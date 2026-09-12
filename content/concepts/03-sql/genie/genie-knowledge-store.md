---
id: genie-knowledge-store
title: The Genie knowledge store
area: genie
level: intermediate
summary: "How authors make a Genie Agent accurate: metadata first, then the knowledge store, then trusted example SQL and functions, with free text last."
prerequisites: [genie-agents]
related: [genie-agent-tuning, genie-benchmarks-monitoring, gold-layer-objects, dashboards-overview]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/genie-agents/tune-quality
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/genie-agents/best-practices
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/genie-agents/set-up
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/uc-semantics/agent-metadata
    checked: 2026-09-11
aliases: [genie instructions, trusted assets, trusted queries, verified answers, knowledge store, sql expressions, genie synonyms, sample questions, common questions]
updated: 2026-09-12
status: published
---

## What it is

A new [[genie-agents|Genie Agent]] knows only what the table and column names suggest. Everything an author adds on top falls into three layers:

1. **Unity Catalog metadata**: table and column comments, primary and foreign keys. It lives with the data and helps every tool, not just Genie.
2. The agent's **knowledge store**: descriptions, synonyms, hidden columns, join relationships, SQL expressions and prompt matching. These apply **only inside this agent** and never change the catalog.
3. **Instructions**: example SQL queries, Unity Catalog SQL functions and plain-text guidance. Example queries and functions that Genie can reuse as they are become **trusted assets**.

## Why it exists

Text-to-SQL fails in predictable ways: a business word that maps to no column ("churned"), a metric with two plausible formulas, a join Genie has to guess, a value spelled differently in the data ("NY" vs "New York"). Each layer targets one of those failures, and each has a different cost. Metadata is reused everywhere, a SQL expression pins one definition, an example query shows a whole pattern, and a paragraph of prose is the least reliable of all, because the model may or may not follow it.

## How it works

### Start in Unity Catalog

Good column comments and declared keys are the cheapest improvement, and they benefit dashboards, Genie Code and humans too. Primary and foreign key constraints in Unity Catalog are picked up automatically as join relationships. If the data is modelled as a **metric view**, its measures and dimensions come pre-defined, and the synonyms declared in the metric view YAML (up to 10 per field, YAML version 1.1) are imported into the agent.

### The knowledge store

| Element | What it fixes |
| --- | --- |
| **Descriptions** | table and column meaning, when you can't or don't want to change the catalog comment |
| **Synonyms** | business vocabulary: "turnover" means `net_revenue` |
| **Hidden columns** | technical columns that only add noise (`_ingest_ts`, surrogate keys) |
| **Join relationships** | how two tables connect, with cardinality (many-to-one, one-to-many, one-to-one) |
| **SQL expressions** | reusable snippets of three kinds: **measures** (`SUM(net_revenue)`), **filters** (`status = 'active'`) and **fields** (derived columns such as a fiscal quarter) |
| **Prompt matching** | spelling and format help: *entity matching* maps "New York" to the stored `NY` for string columns (up to 120 columns), *format assistance* learns how dates and codes look |

Tables with row filters are excluded from prompt matching, and masked columns are skipped, so matching never leaks values a user couldn't see.

### The other three surfaces, in one paragraph

The knowledge store is one of four ways to shape an agent. The other three, example SQL queries, Unity Catalog functions and a block of general instructions, together with the order to reach for them and the limits on each, are covered in [[genie-agent-tuning]]. The short version: the knowledge store teaches Genie what your words and columns mean; the others tell it what to run.

### The authoring loop

1. Create the agent with a handful of tables; **Genie Code** opens and proposes descriptions and example queries. Review every suggestion instead of accepting them in bulk.
2. Add **common questions** (formerly *sample questions*): the prompts shown on the landing page, which double as a first smoke test.
3. Ask realistic questions yourself, read the SQL, and fix what is wrong at the lowest layer that can fix it.
4. Freeze what works into benchmarks and watch real usage (see [[genie-benchmarks-monitoring]]).
5. Keep the configuration in version control: an agent can be deployed from a Declarative Automation Bundle (resource type `genie_spaces`) or exported as a metric view.

## Example

A measure and a filter defined once in the knowledge store, then a parameterized trusted query and a SQL function:

```sql
-- SQL expression (measure) "net revenue":   SUM(net_revenue)
-- SQL expression (filter)  "active customer": status = 'active' AND churned_at IS NULL

-- Parameterized example query: "revenue for <region> since <date>"
SELECT region, SUM(net_revenue) AS net_revenue
FROM sales.gold.orders_daily
WHERE region = :region
  AND order_date >= :start_date
GROUP BY region;
```

```sql
-- A table-valued SQL function the agent can call as a trusted asset
CREATE OR REPLACE FUNCTION sales.gold.top_customers(since DATE)
RETURNS TABLE (customer_id STRING, net_revenue DECIMAL(18,2))
COMMENT 'Top 10 customers by net revenue since a date. Use for "best customers" questions.'
RETURN
  SELECT customer_id, SUM(net_revenue) AS net_revenue
  FROM sales.gold.orders_daily
  WHERE order_date >= since
  GROUP BY customer_id
  ORDER BY net_revenue DESC
  LIMIT 10;

GRANT EXECUTE ON FUNCTION sales.gold.top_customers TO `sales-analysts`;
```

## Common mistakes

- Writing long prose instructions for things a SQL expression or example query would pin down exactly.
- Fixing a column's meaning in the agent's knowledge store when the Unity Catalog comment is simply missing, so every other tool stays confused.
- Adding example queries that were never run, or that hard-code this month's dates.
- Granting access to the agent but not `EXECUTE` on its SQL functions, so the trusted asset fails for everyone but the author.
- Declaring joins by hand that contradict the keys in Unity Catalog.

> [!exam]
> Know the building blocks by name: **common/sample questions, instructions, SQL warehouse, curated Unity Catalog datasets, trusted assets**. A trusted asset is a parameterized example query or a SQL function, and an answer that uses one is shown as verified. When the question is "how do you make Genie use the right definition of a metric", the best answer is a structured one (a SQL expression, a metric view, an example query), not more free text.
