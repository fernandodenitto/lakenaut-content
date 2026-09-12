---
id: genie-agents
title: Genie Agents
area: genie
level: intermediate
summary: A Genie Agent (formerly a Genie space) answers natural-language questions over a small, curated set of governed tables, writing read-only SQL that runs with each user's own Unity Catalog permissions.
prerequisites: [unity-catalog-overview, privileges-grant-revoke]
related: [genie-knowledge-store, genie-benchmarks-monitoring, genie-conversation-api, dashboards-overview, sql-warehouse-sizing, row-filters-column-masks, abac-policies]
exams:
  - cert: data-analyst-associate
    domain: "Developing, Sharing, and Maintaining AI/BI Genie spaces"
    objective: "Describe the purpose, key features, and components of AI/BI Genie spaces."
  - cert: data-analyst-associate
    domain: "Developing, Sharing, and Maintaining AI/BI Genie spaces"
    objective: "Assign permissions via the UI and distribute Genie spaces using embedded links and external app integrations."
sources:
  - url: https://docs.databricks.com/aws/en/genie/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/genie-agents/concepts
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/genie-agents/set-up
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/genie-agents/best-practices
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/genie-agents/talk-to-genie
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/security/auth/access-control
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/ai-bi/release-notes/2026
    checked: 2026-09-11
aliases: [genie space, genie spaces, genie agent, ai/bi genie, genie, natural language sql, conversational analytics, text to sql]
updated: 2026-09-11
status: published
---

> [!changed]
> **Genie spaces are now Genie Agents** (July 2026). Same object, new name: the exam guide, older courses and most blog posts still say "space", and so does the API (`/api/2.0/genie/spaces/...`), the SDK (`create_space`) and the bundle resource (`genie_spaces`). Read both names as one thing.

## What it is

A **Genie Agent** is a conversational interface scoped to one business domain. A user types a question in plain language, Genie turns it into SQL against a curated set of tables, runs it on a SQL warehouse, and answers with a table, a chart and a short explanation. The SQL is always **read-only**, and it is always shown, so the answer can be checked.

"Genie" is now a family of three products, and it pays to keep them apart:

| Product | Who it is for | What it does |
| --- | --- | --- |
| **Genie Agents** | data teams build them, business users ask them | domain-scoped question answering over governed data (this page) |
| **Genie One** | business users | the front door: a home for agents, dashboards and apps, with a chat that routes each question to the right agent (formerly Databricks One) |
| **Genie Code** | developers and analysts | the coding assistant in notebooks, the SQL editor and pipelines (formerly Databricks Assistant) |

## Why it exists

Handing a language model the whole catalog and asking for correct SQL invites ambiguity: which `region` column, which `revenue` definition, which of five similarly named tables. A Genie Agent narrows the problem to a domain a data team has vetted, and lets that team encode business rules once, as metadata, SQL expressions and example queries (see [[genie-knowledge-store]]), instead of every analyst re-deriving them. The result is self-service analytics that stays inside Unity Catalog governance instead of leaking into exported spreadsheets.

## How it works

### Data in scope

An agent is built on Unity Catalog objects: managed, external and foreign tables, views, **metric views** and materialized views. The hard limit is **50** tables or views per agent, but the guidance is to start with **five or fewer** and pre-join what you can into views or metric views. Every extra table is another way for a question to be answered from the wrong place.

### What Genie reads to answer

For every question, Genie assembles context from:

- the Unity Catalog metadata of the curated tables (table and column comments, keys);
- the agent's **knowledge store**: descriptions, synonyms, join relationships and SQL expressions that apply only inside this agent;
- **instructions**: example SQL queries, SQL functions and plain-text guidance;
- the conversation so far (the oldest turns fall out of the context as it grows).

Context carries within one conversation, not across conversations, and Genie does **not** learn on its own from feedback: an answer improves only when an author changes the agent.

### Chat mode and Agent mode

- **Chat mode** is single-pass text-to-SQL: one question, one query, one answer. When the answer comes straight from a trusted example query or SQL function, Genie marks it as a **verified answer**.
- **Agent mode** (formerly *Research Agent*, generally available since July 2026) plans several steps, may ask a clarifying question, runs multiple queries and returns a short report with citations. It is slower, and an **Answer now** button cuts it short.

Either way the generated SQL is one click away. Reading it for metrics with more than one plausible definition is how you catch a quiet mistake before it lands in a slide.

### Permissions: authors and users

Building an agent needs the Databricks SQL entitlement, `CAN USE` on a **pro or serverless** SQL warehouse (serverless is recommended), `SELECT` on the data, and at least `CAN EDIT` on the agent. Workspace and account admins must also have partner-powered AI features enabled.

Using an agent needs consumer access (or the Databricks SQL entitlement), `SELECT` on every object the agent touches, and `CAN VIEW` or `CAN RUN` on the agent. End users do **not** need rights on the warehouse: the author's compute credentials are embedded when the warehouse is saved.

Data access is a different matter. **Each question runs with the asking user's own Unity Catalog permissions**, so [[row-filters-column-masks]] and [[abac-policies]] still apply per person: two people asking the same question through the same agent can legitimately get different rows.

| Level | Adds |
| --- | --- |
| `CAN VIEW` / `CAN RUN` | find the agent, ask questions, give feedback, upload files (the two levels are equivalent here) |
| `CAN EDIT` | change tables, instructions and common questions |
| `CAN MANAGE` | monitor usage, see other users' conversations, change permissions, delete the agent (the creator gets it automatically) |

### Sharing it

Agents are shared from the **Share** dialog with users, groups or all account users, and appear in Genie One next to dashboards and apps. Beyond the workspace, an agent can be embedded in an iframe, reached from Slack or Microsoft Teams, or called through the Conversation API; see [[genie-conversation-api]]. Admins can mark a well-curated agent as certified (or deprecated) with the `system.certification_status` governed tag, so users know which one to trust.

### Limits worth knowing

| Limit | Value |
| --- | --- |
| Tables, views or metric views per agent | 50 (start with 5 or fewer) |
| Conversations per agent | 200,000 |
| Messages per conversation | 10,000 |
| Instructions per agent | 100 (each example query and each function counts as one) |
| Query results kept | 7 days, then re-run |

Older material quotes 30 tables, 10,000 conversations and per-minute question quotas; those figures are out of date.

## Example

A sales agent scoped to three objects, with one trusted example query and one plain-text rule:

```sql
-- Curated objects: sales.gold.orders_daily, sales.gold.customers, sales.gold.revenue_metrics (metric view)
-- Trusted example query, saved in the agent: "monthly revenue by region"
SELECT region, SUM(net_revenue) AS net_revenue
FROM sales.gold.orders_daily
WHERE order_date >= DATE_TRUNC('MONTH', CURRENT_DATE())
GROUP BY region
ORDER BY net_revenue DESC;
```

```yaml
# General instruction (natural language, not executed)
instructions: |
  "Revenue" always means net_revenue, never gross_revenue.
  Exclude region = 'TEST' unless the question explicitly asks for test data.
```

A regional manager with a row filter on `region` asks "what was revenue this month?" and sees only their region, through the same agent the CFO uses.

## Common mistakes

- Curating every table that might be relevant. Coverage goes up on paper, accuracy goes down in practice.
- Assuming a shared service credential decides what users see. The warehouse runs on the author's credentials; data access is checked per user.
- Accepting Genie Code's suggested descriptions and example queries without reading them, and inheriting whatever it guessed.
- Expecting Genie to "learn" from thumbs-down. It doesn't; an author has to fix the knowledge store or instructions.
- Treating a first answer as authoritative without opening the SQL, especially for a metric with several possible definitions.
- Confusing Genie Agents (question answering over data) with Genie Code (the coding assistant) or Genie One (the business-user home).

> [!exam]
> The Data Analyst Associate guide still says **"AI/BI Genie spaces"**: read it as Genie Agents. Expect questions on who needs which permission (the warehouse credential is the author's, the data access is the user's), on what goes into an agent (curated tables, instructions, example queries as trusted assets, a warehouse, common questions), and on distribution (share dialog, embedding, external apps).
