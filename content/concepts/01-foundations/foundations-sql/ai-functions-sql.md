---
id: ai-functions-sql
title: AI functions in SQL
area: foundations-sql
level: intermediate
summary: "The ai_* family: task-specific functions for parsing, extraction, classification and text work, the general-purpose ai_query, and which of them are actually generally available."
prerequisites: [spark-sql-basics, foundation-model-apis]
related: [batch-inference-ai-query, rag-pipeline, ai-search-indexes, semi-structured-data, udfs-and-alternatives]
exams:
  - cert: genai-engineer-associate
    domain: "Design Applications"
    objective: "Select model tasks to accomplish a given business requirement."
sources:
  - url: https://docs.databricks.com/aws/en/large-language-models/ai-functions
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/large-language-models/ai-query
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/functions/ai_parse_document
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/functions/ai_extract
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/functions/ai_classify
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/functions/ai_translate
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/functions/ai_forecast
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/functions/ai_enrich
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/data-types/variant-type
    checked: 2026-09-12
aliases: [ai functions, ai_classify, ai_extract, ai_parse_document, ai_summarize, ai_translate, ai_mask, ai_gen, ai_similarity, ai_analyze_sentiment, ai_forecast, ai_enrich, ai_search, ai_prep_search, ai_top_drivers, vector_search]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

AI functions are built-in SQL functions, all named `ai_*`, that apply a model to a column. They run from the SQL editor, from notebooks, from Lakeflow pipelines and from jobs, and they need no endpoint of your own: the query runs on the compute you submit it from, and the inference runs on the Databricks-managed infrastructure behind [[foundation-model-apis]].

The family splits in two. **Task-specific functions** are scoped to one job each, with no prompt to write: `ai_parse_document` reads a PDF, `ai_classify` applies your labels, `ai_extract` fills a schema, `ai_forecast` extends a time series. **`ai_query`** is the general-purpose one, where you choose the model, write the prompt and declare the return type. [[batch-inference-ai-query]] covers `ai_query` in detail; this page is about choosing between the members of the family and knowing which of them you can actually build on.

## Why it exists

The alternative is a serving endpoint and a client. You provision or select an endpoint, write a notebook that reads batches, handles rate limits, retries the failures, checkpoints its progress, and parses whatever comes back. That is a week of work per team, and it is wrong in a different way each time.

Task-specific functions go further than moving that work into the engine: they remove the prompt as well. There is no prompt to tune for `ai_classify`, no output format to police, no model to pick and repick as better ones ship. You give it labels and it gives you labels back. Databricks recommends starting there and reaching for `ai_query` only when no task-specific function matches, which is the right instinct: a prompt you wrote is a prompt you own forever.

## How it works

### Which functions exist, and what state each is in

This is the part that moves. Maturity is per function, not per family, and it changed during 2026.

| Function | What it does | State, September 2026 |
| --- | --- | --- |
| `ai_query` | any prompt, any supported model | GA |
| `ai_parse_document` | parses text, tables and figures out of PDFs, images and Office files | GA |
| `ai_extract` | fills a schema you define from text or a parsed document | GA |
| `ai_classify` | applies labels you define, single or multi-label | GA |
| `ai_summarize`, `ai_translate`, `ai_fix_grammar`, `ai_mask`, `ai_analyze_sentiment`, `ai_similarity`, `ai_gen` | one-line text transforms and analyses | Public Preview |
| `vector_search` | queries an AI Search index from SQL | Public Preview |
| `ai_forecast` | extends a time series to a horizon | version 1 Public Preview, version 2, the recommended one, Beta |
| `ai_prep_search` | chunks parsed documents into retrieval-ready pieces | Beta |
| `ai_search` | ranked, deduplicated retrieval plus a grounded answer | Beta |
| `ai_enrich` | new columns from a schema, optionally grounded in search | Beta |
| `ai_top_drivers` | ranks the dimension values behind a change in a metric | Beta |

Read that table alongside the function's own reference page rather than the overview. The overview page tags only the four Beta functions; the Public Preview banners live on the individual pages, so `ai_summarize` looks generally available until you open its page. For anything not marked GA, treat it as something to know exists rather than something to put in a nightly job.

The GA four are also the ones with versioned interfaces. `ai_classify` and `ai_extract` are on version 2.1, and version 1 is a different function in practice: it returned a plain `STRING`, while 2.0 and later return a `VARIANT` carrying `response`, `metadata` and `error_message`. Pin the version explicitly with `options => map('version', '2.1')` so a default change does not rewrite your column type.

### What they need

- No AI function runs on a **Classic** SQL warehouse. Serverless or pro is the floor.
- Databricks Runtime 15.4 LTS or above, with 18.2 or above recommended for performance and for the newest features.
- `ai_parse_document` needs Databricks Runtime 17.3 or above, and on serverless compute an environment version of 3 or above, because its output is `VARIANT`.
- `ai_forecast` and `ai_top_drivers` need the workspace enrolled in the Predictive AI Functions preview, and `ai_forecast` is documented for Databricks SQL rather than for Databricks Runtime.
- Availability is regional, and a workspace admin can restrict which task-specific functions your organisation may call through Unity Catalog permissions.

### What it costs

The compute running the query is always billed. Whether there is a second charge depends on the function:

- Task-specific functions run inference on Databricks-managed serverless GPU infrastructure through Model Serving, billed on top of your query compute.
- `ai_query` is billed for the endpoint you name. Databricks-hosted foundation model endpoints bill like the task-specific functions; custom models and provisioned throughput run on their own serving compute and bill accordingly.
- `ai_forecast` and `ai_top_drivers` run entirely on the compute you submit them from, with no separate inference charge.
- `vector_search` goes through the managed AI Search service.

In system tables (see [[system-tables]]) the inference shows up under `billing_origin_product = 'MODEL_SERVING'` with `product_features.model_serving.offering_type = 'BATCH_INFERENCE'`. The exception is `ai_parse_document`, `ai_extract` and `ai_classify`, which are recorded under the `AI_FUNCTIONS` product instead, so a cost query written for one will miss the other.

### They compose

`ai_extract` and `ai_classify` accept a `VARIANT` produced by another AI function as well as a plain `STRING`. That makes document processing a single SQL statement rather than a pipeline of intermediate tables: parse, then extract, then classify, all inside one `SELECT`.

## Example: invoices from a volume to a typed table

```sql
CREATE OR REPLACE TABLE main.silver.invoice_fields AS
WITH parsed AS (
  SELECT path, ai_parse_document(content) AS doc
  FROM READ_FILES('/Volumes/main/raw/invoices/', format => 'binaryFile')
)
SELECT
  path,
  ai_extract(
    doc,
    '{"invoice_id":    {"type": "string"},
      "vendor_name":   {"type": "string", "description": "Legal business name"},
      "total_amount":  {"type": "number"},
      "invoice_date":  {"type": "string", "description": "Date in YYYY-MM-DD format"}}',
    options => map('version', '2.1')
  ) AS fields
FROM parsed;
```

The result column is a `VARIANT`, so the next query reads it with the path operator (see [[semi-structured-data]]) and, importantly, checks the error field rather than assuming every row worked:

```sql
SELECT
  path,
  fields:response.invoice_id.value::STRING    AS invoice_id,
  fields:response.vendor_name.value::STRING   AS vendor_name,
  fields:response.total_amount.value::DECIMAL(12,2) AS total_amount,
  fields:response.invoice_date.value::DATE    AS invoice_date
FROM main.silver.invoice_fields
WHERE fields:error_message IS NULL;
```

Classification is the same shape and shorter. No prompt, no model name, and a confidence score you can threshold on:

```sql
SELECT
  review_id,
  ai_classify(
    body,
    '["billing", "shipping", "product_quality", "other"]',
    map('version', '2.1', 'enableConfidenceScores', 'true')
  ) AS topic
FROM main.silver.reviews;
```

Reach for [[batch-inference-ai-query]] instead when the task is not one of these: a bespoke rubric, a fine-tuned model of your own, or an output shape that needs `returnType` to be a struct.

## Common mistakes

- **Treating the family as one maturity.** Four functions are GA, eight are Public Preview and four are Beta, with `ai_forecast` straddling the last two. Check the function's own reference page before it goes into anything scheduled.
- **Running them on a Classic warehouse.** They are not available there at all, and the failure looks like a missing function rather than a compute problem.
- **Letting the version float on `ai_classify` or `ai_extract`.** Version 1 returns a `STRING` and version 2 and later return a `VARIANT`. Pin `options => map('version', '2.1')`, or a downstream cast breaks on a day you did not deploy anything.
- **Never reading `error_message`.** The `VARIANT` result carries a per-row error field. Rows that failed look like rows that returned nothing, and a `count(*)` will not tell them apart.
- **Writing a prompt for a task that already has a function.** An `ai_query` prompt that classifies text is a prompt you maintain, evaluate and re-tune when the model changes. `ai_classify` is Databricks's problem instead.
- **Costing a workload from one system-table query.** `ai_parse_document`, `ai_extract` and `ai_classify` bill under `AI_FUNCTIONS`, everything else under `MODEL_SERVING` with the `BATCH_INFERENCE` offering type.

> [!exam]
> The GenAI Engineer Associate guide asks you to pick the model task that fits a business requirement. Know that task-specific functions are the recommended starting point and `ai_query` is the fallback for a custom prompt, a custom model, or an output shape you need to declare. Know the requirement that is asked most directly: AI functions do not run on Classic SQL warehouses, and the runtime floor is 15.4 LTS. The distinction that catches people is `ai_gen` against `ai_query`: both take a prompt, but `ai_gen` gives you no choice of model and no control over parameters, which is exactly why the question usually wants `ai_query`.
