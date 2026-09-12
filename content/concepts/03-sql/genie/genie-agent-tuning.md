---
id: genie-agent-tuning
title: Tuning a Genie Agent for correct answers
area: genie
level: intermediate
summary: "The three instruction surfaces of a Genie Agent: example SQL queries, Unity Catalog SQL functions and plain-text instructions, which of them produce verified answers, and the order to reach for each."
prerequisites: [genie-agents]
related: [genie-knowledge-store, genie-benchmarks-monitoring, genie-ontology, metric-views]
exams:
  - cert: data-analyst-associate
    domain: "Developing, Sharing, and Maintaining AI/BI Genie spaces"
    objective: "Create Genie spaces by defining reasonable sample questions and domain-specific instructions, choosing SQL warehouses, curating Unity Catalog datasets (tables, views...), and vetting queries as Trusted Assets."
sources:
  - url: https://docs.databricks.com/aws/en/genie-agents/tune-quality
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/genie-agents/concepts
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/genie-agents/best-practices
    checked: 2026-09-12
aliases: [genie instructions, general instructions, example sql queries, trusted assets, verified answer, usage guidance, sql functions in genie, knowledge mining, genie inspect]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

A [[genie-agents|Genie Agent]] answers correctly for two reasons: the data underneath it is described well, and the author has given it worked answers to the questions people actually ask. The first half is the knowledge store, and it has its own page (see [[genie-knowledge-store]]). This page is the second half: the **instructions** surface, which is three things and only three.

| Mechanism | What it is |
| --- | --- |
| **Example SQL queries** | reference answers for common questions, which Genie selects from when a prompt looks similar |
| **SQL functions** | Unity Catalog scalar or table-valued functions attached to the agent as callable tools |
| **General instructions** | one block of plain text for rules that apply to every prompt |

A parameterised example query or an attached SQL function is a **trusted asset**: logic an author wrote and verified, so when Genie uses one the answer comes from that logic rather than from SQL the model composed on the spot. Chat mode marks those answers as **verified**.

## Why it exists

Even a well-scoped agent has to guess. Which of two plausible formulas is "margin"? Does "last quarter" mean calendar or fiscal? When a user says "breakdown of performance", which columns did they mean?

The three mechanisms exist because those guesses cost different amounts to fix. A paragraph of prose is the cheapest to write and the least reliable, because the model may or may not act on it. An example query shows a whole pattern and can be reused verbatim. A function is the most reliable: Genie cannot see or rewrite its body, so the logic is exactly what the author committed. Knowing which to reach for, and in what order, is most of the job.

## How it works

### The order to reach for each

Databricks states the preference plainly: structured definitions first, example SQL second, plain text as a last resort. In practice that is four rungs, not three, because the knowledge store sits below them.

| Reach for | When the failure is |
| --- | --- |
| Unity Catalog comments and keys | a column or a join Genie has no way to understand |
| Knowledge store SQL expressions | a business term with one settled definition: a KPI, a filter, a derived field |
| Example SQL queries | a whole question shape that is multi-part, ambiguous or specific to your organisation |
| SQL functions | logic no static or parameterised query can express, or logic that must not be visible or editable |
| General instructions | something global that no SQL can carry: fiscal calendar, output language, rounding, when to ask for clarification |

The rule of thumb: if a rule can be written as SQL, write it as SQL. Text instructions are for context that applies everywhere and fits nowhere else.

### Example queries as reference answers

An example query is a pair: a sample question and the SQL that answers it. Write the question the way a user would actually type it, because that phrasing is what the prompt is matched against. Genie either reuses the query directly for a matching question or takes structural clues from it for a similar one, which is why examples encoding logic unique to your data are worth far more than examples of ordinary aggregation.

Two details are easy to miss. Each example has a **Usage guidance** field for saying when it is and is not relevant. And anybody with `CAN EDIT` can see which query produced a given response, which is how you debug a wrong answer instead of guessing at it.

### Parameters, and what makes a query trusted

Adding `:parameter_name` to an example query lets Genie lift a value out of the user's question and reuse the query's structure. Each parameter has three settings:

- **Keyword**, changeable only by editing the query text.
- **Data type**: `String` (default), `Date`, `Date and Time`, `Decimal`, `Integer`. If the value Genie supplies does not match the declared type it is treated as the wrong type, and the answer is wrong without being obviously wrong.
- **Comment**, describing the permitted values or range. This is context for Genie, not documentation for humans, and it is how you stop `:region` being filled with a country.

In chat mode, when the exact text of a parameterised query is used to produce a response, the answer is marked verified and the user can edit the parameter value and re-run it. That is what "vetting queries as trusted assets" amounts to: the author owns the SQL, the question only supplies the arguments.

### SQL functions

Functions registered in Unity Catalog can be attached to the agent, both scalar and table-valued. Genie calls them with user-supplied arguments and cannot read or modify the body, which makes them the right home for a calculation that must not drift or must not be shown. Since September 2026 the function's description is visible alongside it in the agent, so authors can see what they attached.

Agent users need `EXECUTE` on any function used as a trusted asset. Granting access to the agent and forgetting the function grant is a common way to ship a trusted asset that works for its author and nobody else.

### What only prose can do

General instructions apply to every prompt, and two behaviours are available nowhere else.

**Clarification questions** need four parts to work: the trigger topic, the details that must be present, an explicit statement that Genie must ask before answering, and the exact question to ask. Vague wording ("ask for clarification about sales") does not produce the behaviour. Put these at the end of the block.

**Summary customisation** goes in its own trailing section headed "Instructions you must follow when providing summaries". Only text instructions influence the natural-language summary; SQL examples and knowledge store expressions do not touch it. Summary length and detail level cannot be controlled at all.

### Two limits, and what counts against which

| Limit | Value | What counts |
| --- | --- | --- |
| Instructions | 100 per agent | each example query, each SQL function, and the entire general-instructions block as one |
| Knowledge store snippets | 200 per agent | table descriptions, join relationships, SQL expressions |

Text instructions, example queries, functions, column descriptions and prompt matching settings do not count against the 200. Two budgets, not one.

### Consistency beats volume

Genie is nondeterministic, so contradictory guidance produces answers that vary between asks. If the text block says round to two decimals, every example query must round to two decimals. Piling on instructions also degrades quality, particularly in long conversations, because there is more competing context to prioritise.

Genie proposes work of its own too. **Knowledge mining** turns declared primary and foreign keys into join relationships automatically, and when an author thumbs-up a response or downloads its results, Genie analyses that query and may suggest new SQL expressions or joins. They are suggestions to review, not changes. Separately, **Inspect** is in **Public Preview**: it re-reads the generated SQL, writes smaller queries to check filter values, date windows and joins, and returns whichever version answers better. Benchmarks, by contrast, are the measurement half and deliberately never feed context back (see [[genie-benchmarks-monitoring]]).

## Example: one metric, three ways

The weakest version, in general instructions. Genie may follow it and may not:

```text
Open pipeline means the sum of opportunity amount where forecastcategory is 'Pipeline'
and the stage name does not contain 'closed'. Fiscal year starts in February, so FY26
runs from 2026-02-01 to 2027-01-31. Round all currency to two decimal places.
```

The same logic as a parameterised example query, titled with the phrasing a user would type. This is a trusted asset, and an answer built from it is marked verified:

```sql
-- Title: "What is our open pipeline for <region>?"
SELECT a.region__c AS region,
       ROUND(SUM(o.amount), 2) AS open_pipeline
FROM sales.crm.opportunity o
JOIN sales.crm.accounts a ON o.accountid = a.id
WHERE o.forecastcategory = 'Pipeline'
  AND o.stagename NOT ILIKE '%closed%'
  AND (a.region__c = :region OR :region IS NULL)   -- Comment on :region: EMEA, AMER, APJ
GROUP BY ALL
ORDER BY open_pipeline DESC;
```

And as a table-valued function, for logic that should not be visible or edited. Genie calls it and never sees the body:

```sql
CREATE OR REPLACE FUNCTION sales.crm.open_pipeline_by_rep(fiscal_year INT)
RETURNS TABLE (owner_id STRING, open_pipeline DECIMAL(18,2))
COMMENT 'Open pipeline per sales rep for a fiscal year starting 1 February. Use for questions about rep-level or team-level pipeline.'
RETURN
  SELECT o.ownerid,
         ROUND(SUM(o.amount), 2)
  FROM sales.crm.opportunity o
  WHERE o.forecastcategory = 'Pipeline'
    AND o.stagename NOT ILIKE '%closed%'
    AND o.closedate >= MAKE_DATE(fiscal_year - 1, 2, 1)
    AND o.closedate <  MAKE_DATE(fiscal_year, 2, 1)
  GROUP BY o.ownerid;

GRANT EXECUTE ON FUNCTION sales.crm.open_pipeline_by_rep TO `sales-analysts`;
```

The fiscal calendar still needs the text instruction: the function encodes the dates, but nothing tells Genie that "FY26" means 2026 unless prose says so.

## Common mistakes

- **Writing prose for a rule that is a SQL expression.** A definition in text is a suggestion to the model; a SQL expression or a function is applied as written.
- **Titling an example query like a report.** The title is the matching surface. "Monthly revenue by region, FY26 v2" matches nothing a person would type.
- **Leaving a parameter on the default `String` type, or with no Comment.** Genie fills it with whatever the question suggested, and a mistyped or out-of-range value gives a plausible wrong answer.
- **Shipping a SQL function without granting `EXECUTE`.** It works for the author and fails for every user.
- **Contradicting yourself across layers.** Rounding in the text block and none in the examples is enough to make answers inconsistent between asks.
- **Expecting text instructions to shorten a summary, or accepting knowledge mining suggestions in bulk.** Summary length is not controllable at all, and a mined suggestion inherits whatever the one query behind it assumed.

> [!exam]
> The Data Analyst Associate guide phrases this as defining sample questions and domain-specific instructions and **vetting queries as Trusted Assets**. Know that a trusted asset is a **parameterised example query** or a **Unity Catalog SQL function**, that using one yields a **verified answer**, and that users need `EXECUTE` on the function. When a question asks how to make Genie use the right definition of a metric, the best answer is always the most structured one available, not more free text.
