---
id: structured-outputs
title: Structured outputs
area: serving
level: intermediate
summary: response_format constrains a chat model's answer to valid JSON or to a JSON schema, with a 64-key ceiling and a deliberately reduced subset of JSON Schema.
prerequisites: [foundation-model-apis]
related: [batch-inference-ai-query, model-serving-endpoints, model-services, rag-pipeline, pipelines-expectations]
exams:
  - cert: genai-engineer-associate
    domain: "Design Applications"
    objective: "Design a prompt that elicits a specifically formatted response"
sources:
  - url: https://docs.databricks.com/aws/en/machine-learning/model-serving/structured-outputs
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/api-reference
    checked: 2026-09-12
aliases: [response_format, json_schema, json_object, strict, structured outputs, json mode, constrained decoding]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

**Structured outputs** are a `response_format` field on a chat request that tells the serving layer what shape the answer must take. It works with any supported chat model on Foundation Model APIs, both pay-per-token and provisioned throughput, and you send the same request whatever the model is underneath: Databricks translates it into the provider's own structured-output mechanism, so you never write OpenAI's format for one model and Anthropic's for another.

There are three values:

| `response_format` | What you get back | Use it when |
| --- | --- | --- |
| `{"type": "text"}` | free text, the default | the answer is for a human to read |
| `{"type": "json_object"}` | valid JSON, no guarantee about its shape | you want JSON but cannot describe it up front |
| `{"type": "json_schema", "json_schema": {…}}` | JSON that follows the schema you supplied | the output has a destination: a column, a field, a downstream call |

The `json_schema` object takes a `name` and a `schema`, both required, an optional `description` the model reads to understand what the format is for, and `strict`. With `strict: true` the model follows the schema exactly, and only a subset of JSON Schema is supported in that mode.

## Why it exists

Asking for JSON in the prompt works most of the time, and "most of the time" is precisely the problem. Over a million rows, a fraction of a percent of responses will open with "Here is the JSON you asked for", or rename `total` to `total_amount`, or return `"49.99 USD"` where the column is `DECIMAL(10,2)`. So you write a parser. Then a retry around the parser. Then a quarantine table for the rows the retry could not save, and a morning job to look at it.

Constraining the format moves the guarantee from the prompt, where it is a request, into the decoding step, where it is enforced. What changes in practice is the failure mode. Prompt engineering fails by returning something plausible that does not fit, which lands in your table and is discovered a week later by whoever notices the numbers. A schema fails by rejecting the request, loudly, at the point of the call. For anything feeding a table, the second is worth a great deal more than the first, and it is the reason this matters more than any amount of prompt wording.

## How it works

### The reduced JSON Schema

Foundation Model APIs accept the schemas OpenAI accepts, minus the constructs that make generation harder and the output worse. Simpler schemas produce higher-quality JSON, so the subset is a deliberate choice rather than an unfinished feature.

Not supported at all:

- regular expressions through `pattern`;
- schema composition and indirection: `anyOf`, `oneOf`, `allOf`, `prefixItems`, `$ref`;
- lists of types, except the one special case `[type, "null"]` where one entry is a valid JSON type and the other is `"null"`.

Accepted but not enforced, which is the more dangerous category because nothing errors: length and size keywords such as `maxProperties`, `minProperties` and `maxLength`. If a string must be at most 40 characters for the column it lands in, truncate or validate it yourself.

### The ceilings

The maximum number of keys in a schema is **64**. Heavy nesting degrades generation quality even when it is within the limits, and the documented advice is to flatten wherever you can. A nested object of objects three levels deep to mirror your domain model is a worse schema than a flat set of 20 fields with prefixed names, and it will extract less accurately.

### What each model supports

Every supported chat model takes `response_format`, but Anthropic Claude models on Databricks come with three extra constraints, and each one has bitten somebody:

- only `json_schema` is supported. `json_object` is not. For unconstrained output, leave `response_format` out entirely rather than passing `text`;
- **streaming is not supported** with a `response_format`. Set `stream` to `false`;
- `response_format` **cannot be combined** with `tools` or `tool_choice`. An agent that calls tools and returns a schema-constrained final answer needs those as two separate calls.

### The cost

To raise the quality of constrained output, the platform adds instructions to the prompt behind the scenes. Those instructions are tokens, which means both input and output token counts go up relative to the same request without `response_format`, which means the bill does too. It is normally a good trade against the parsing and requeueing it removes, but it is not free and it is worth knowing before you compare two runs and wonder where the tokens went.

### Conformance is not correctness

A schema guarantees the shape and the types. It guarantees nothing about the content. A field typed `string` will contain a string, not necessarily one of the three categories you had in mind, and certainly not necessarily the truth. The schema replaces your parser; it does not replace your validation. Put the business rules where rules belong, as expectations or a `CHECK` constraint on the table the output lands in (see [[pipelines-expectations]]).

### The SQL sibling

If the model is being applied to a whole table, you probably want `ai_query` with `returnType` instead of a client loop, and the engine handles parallelism and retries for you. See [[batch-inference-ai-query]]. This page is about the serving API: a single request, from application code, against an endpoint (see [[model-serving-endpoints]]) or a governed model service (see [[model-services]]).

## Example: extracting contract fields into a typed table

A flat schema, four fields, strict:

```python
import json
import os

from openai import OpenAI

client = OpenAI(
    api_key=os.environ["DATABRICKS_TOKEN"],
    base_url=os.environ["DATABRICKS_BASE_URL"],  # https://<workspace>/serving-endpoints
)

contract_text = spark.read.table("main.bronze.contracts").first()["body"]

response_format = {
    "type": "json_schema",
    "json_schema": {
        "name": "contract_terms",
        "description": "Commercial terms as printed on a signed supplier contract.",
        "schema": {
            "type": "object",
            "properties": {
                "supplier_name": {"type": "string"},
                "monthly_fee_eur": {"type": "number"},
                "notice_period_days": {"type": "integer"},
                # [type, "null"] is the one list of types the subset allows.
                "auto_renews": {"type": ["boolean", "null"]},
            },
            "required": ["supplier_name", "monthly_fee_eur", "notice_period_days"],
        },
        "strict": True,
    },
}

response = client.chat.completions.create(
    model="databricks-claude-sonnet-4-5",
    # stream must stay false: Claude does not stream a constrained response.
    stream=False,
    response_format=response_format,
    messages=[
        {
            "role": "system",
            "content": "Extract the commercial terms from the contract text. Use the contract's own figures.",
        },
        {"role": "user", "content": contract_text},
    ],
)

terms = json.loads(response.choices[0].message.content)
```

The schema got you four well-typed fields. It did not check that the notice period is one your legal team would accept, so that check belongs on the table:

```sql
CREATE TABLE main.silver.contract_terms (
  contract_id STRING NOT NULL,
  supplier_name STRING NOT NULL,
  monthly_fee_eur DECIMAL(12, 2) NOT NULL,
  notice_period_days INT NOT NULL,
  auto_renews BOOLEAN
);

ALTER TABLE main.silver.contract_terms
  ADD CONSTRAINT plausible_notice CHECK (notice_period_days BETWEEN 0 AND 365);
```

## Common mistakes

- **Asking for JSON in the prompt and parsing hopefully.** This is the case `response_format` exists to remove, and the wrong rows are the ones you never notice.
- **Using `json_object` when you know the shape.** You get valid JSON with unstable key names, which is harder to work with than either free text or a schema.
- **Mirroring a domain model in a deeply nested schema.** It stays under 64 keys and still extracts worse than the flat equivalent. Flatten and prefix.
- **Relying on `pattern`, `anyOf` or `$ref`.** They are not in the supported subset, so a schema built around them is not doing what it looks like it is doing.
- **Believing `maxLength`.** It is accepted and ignored. Length limits are your problem, not the endpoint's.
- **Streaming a constrained Claude response, or combining it with `tools`.** Both are unsupported. Split the tool-calling turn from the structured final answer.
- **Treating a conforming response as a validated one.** Types are guaranteed, meaning is not. Keep an expectation or a constraint between the model and the table.

> [!exam]
> The Generative AI Engineer Associate guide asks you to "design a prompt that elicits a specifically formatted response", and the answer the exam wants is the parameter rather than the prompt wording. Know the three values of `response_format`, that `json_object` gives valid JSON with no schema while `json_schema` plus `strict: true` gives a schema the model must follow, and that the schema ceiling is **64 keys**. The distinction that catches people out: `ai_query` uses `returnType` to do the same job from SQL, so read the question for whether it is describing a single request from application code or a batch over a table.
