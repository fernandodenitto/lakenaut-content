---
id: batch-inference-ai-query
title: Batch inference with ai_query
area: serving
level: intermediate
summary: Running a model over a whole table from SQL, with the platform handling parallelism, retries and scale, and failOnError deciding whether one bad row ruins the job.
prerequisites: [foundation-model-apis, spark-sql-basics]
related: [model-services, ai-gateway-basics, model-serving-endpoints, gold-layer-objects, structured-streaming-basics]
exams:
  - cert: genai-engineer-associate
    domain: "Application Development"
    objective: "Apply a model across a dataset from SQL, choosing an endpoint type and handling partial failure."
sources:
  - url: https://docs.databricks.com/aws/en/large-language-models/ai-query
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/large-language-models/ai-functions
    checked: 2026-09-12
aliases: [ai_query, batch inference, batch LLM, failOnError, returnType, modelParameters, bulk inference]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

`ai_query` calls a model from SQL. Point it at an endpoint, give it a prompt built from your columns, and it returns the model's answer as a column. Run it over a table and you have batch inference, with no loop, no notebook and no serving client.

It is one function with three kinds of target:

| Target | What it looks like | When to use it |
| --- | --- | --- |
| A Databricks-hosted model | `ai_query('system.ai.<model>', prompt)` | the default. Nothing to provision |
| Provisioned throughput | the name of your endpoint | steady, high-volume work where you want reserved capacity |
| A custom or external model | your own serving endpoint | your own model, or a provider reached through the gateway |

The platform handles the parts that make hand-written batch inference miserable: parallelism, retries and scaling.

## Why it exists

The obvious way to classify a million support tickets is a loop: read a batch, call an API, collect responses, handle timeouts, back off on rate limits, checkpoint so a failure does not restart everything. That code is written once per team and is wrong in a different way each time.

`ai_query` moves it into the engine. You express the intent as a query and the platform decides how many requests to have in flight, what to do with a failed one, and how to keep the endpoint busy without overwhelming it.

## How it works

### The shape of a call

```sql
SELECT
  ticket_id,
  ai_query(
    'system.ai.gpt-oss-120b',
    concat('Classify this support ticket as billing, technical or account. Answer with one word only.\n\n', body)
  ) AS category
FROM main.silver.tickets;
```

For a custom endpoint the named arguments come out:

```sql
SELECT
  ticket_id,
  ai_query(
    endpoint => 'ticket-classifier',
    request => body,
    returnType => 'STRING',
    modelParameters => named_struct('max_tokens', 20, 'temperature', 0.0),
    failOnError => false
  ) AS result
FROM main.silver.tickets;
```

`returnType` is what lets the result land as something other than a string, which matters when the next step is a join rather than a human reading it. `modelParameters` carries the usual generation settings, and a temperature of zero is the right default for anything you intend to store.

### failOnError, the argument that decides your evening

By default one failed row fails the statement. On a million rows that is the wrong trade: you lose the 999,999 that worked.

Setting `failOnError => false` changes the contract. The query completes, successful rows carry their answer, failed rows carry an error message, and you decide what to retry. Databricks recommends it for large workloads, and so does anyone who has watched a six-hour job die at 94%.

```sql
CREATE OR REPLACE TABLE main.gold.ticket_categories AS
SELECT
  ticket_id,
  ai_query('system.ai.gpt-oss-120b', concat('Classify: ', body), failOnError => false) AS result
FROM main.silver.tickets;

-- What failed, and why.
SELECT result.errorMessage, count(*) FROM main.gold.ticket_categories
WHERE result.errorMessage IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;
```

### Give it the whole dataset

The instinct from hand-rolled inference is to batch: a thousand rows at a time, in a loop, to be kind to the endpoint. Here that instinct costs you throughput. The documented guidance is to submit the full dataset in one query and let the platform parallelise, because it can see the whole workload and size the concurrency to it. Your loop cannot.

### What it needs

Databricks Runtime 15.4 LTS or above, with 18.2 and later recommended. It does not run on classic SQL warehouses, so a serverless or pro warehouse is the floor for the SQL path.

### Where it fits with the other functions

`ai_query` is the general one: any model, any prompt. The task-specific functions such as `ai_classify`, `ai_extract` and `ai_translate` are narrower, need no prompt engineering, and are the better choice when your task is exactly one of theirs. Reach for `ai_query` when the task is yours.

## Example: a nightly enrichment that does not fall over

```sql
CREATE OR REFRESH MATERIALIZED VIEW main.gold.ticket_enrichment
SCHEDULE EVERY 1 DAY
AS SELECT
  t.ticket_id,
  t.created_at,
  ai_query(
    'system.ai.gpt-oss-120b',
    concat(
      'Return JSON with keys category and urgency. ',
      'Category is one of billing, technical, account. Urgency is low, medium or high.\n\n',
      t.body
    ),
    returnType => 'STRUCT<category: STRING, urgency: STRING>',
    failOnError => false
  ) AS enrichment
FROM main.silver.tickets t
WHERE t.created_at >= current_date() - INTERVAL 1 DAY;
```

Three choices make this production rather than a demo. `returnType` gives a struct, so downstream queries filter on `enrichment.urgency` instead of parsing text. `failOnError` keeps the run alive. And the window in the `WHERE` clause means the cost is proportional to yesterday, not to the history of the table.

## Common mistakes

- **Leaving `failOnError` at its default on a large table.** One malformed row ends the run, and you pay for everything it processed before dying.
- **Batching by hand.** Submitting slices in a loop starves the parallelism the platform would have used. Give it the whole query.
- **Returning a string and parsing it later.** If the answer has a shape, declare it with `returnType` and let the engine enforce it.
- **Running it on the whole table every night.** Filter to what changed. This is the difference between a job that costs the price of a coffee and one that gets an email from finance.
- **A non-zero temperature on stored output.** If the same input can produce a different row tomorrow, the table is not reproducible and nobody will trust it.

> [!exam]
> Know that `ai_query` targets Databricks-hosted models, provisioned throughput endpoints and custom or external endpoints through the same function, and that it needs a serverless or pro warehouse rather than a classic one. The argument worth remembering by name is `failOnError`: the question usually describes a large batch where some rows fail, and the expected answer is to set it to false and retry the failures rather than to split the job into chunks.
