---
id: model-services
title: Model services on Unity Gateway
area: ai-gateway
level: intermediate
summary: A model service is a governed LLM endpoint that lives in a Unity Catalog schema, with grants, routing, rate limits and usage tracking attached to the object itself.
prerequisites: [ai-gateway-basics, unity-catalog-overview]
related: [foundation-model-apis, model-serving-endpoints, privileges-grant-revoke, ai-playground]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/ai-gateway/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/ai-gateway/model-services
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/ai-gateway/configure-endpoints
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/ai-gateway/query-model-services
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/ai-gateway/rate-limits
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/ai-gateway/usage-tracking
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/release-notes/unity-gateway/
    checked: 2026-09-11
aliases: [model service, model services, model apis, system.ai, unity gateway model service, ai gateway model service, governed llm endpoint]
updated: 2026-09-11
status: published
maturity: ga
---

## What it is

A **model service** is a large language model endpoint that exists as an object in a Unity Catalog schema. It has a three-level name, an owner, a comment and tags, exactly like a table, and it references one or more **destinations** with routing and fallback between them. You query it by its fully qualified name, and who is allowed to do that is a `GRANT`, not a workspace setting.

This is the shape [[ai-gateway-basics|Unity Gateway]] took when it went generally available on 4 August 2026. The gateway itself was called Mosaic AI Gateway until 2026, and the older model of configuring rate limits and logging on each individual serving endpoint still exists in the documentation, now marked legacy.

## Why it exists

The first version of the gateway attached governance to a serving endpoint, and a serving endpoint belongs to one workspace. An organisation with six workspaces therefore had six copies of the same configuration, six sets of rate limits drifting apart, and six answers to "which model are we allowed to use for customer data". Nobody could see total spend without joining six workspaces' worth of tables.

Making the endpoint a catalog object moves the problem to where the rest of governance already lives. Define the service once in the metastore, and every workspace attached to that metastore can use it under the same grants, the same limits and one usage table. It also means an LLM endpoint shows up in Catalog Explorer next to the data it will be pointed at, which is the right place for a security review to happen.

## How it works

### A Unity Catalog securable

Five privileges cover the lifecycle.

| Privilege | What it allows |
| --- | --- |
| `USE CATALOG`, `USE SCHEMA` | reach the service at all; needed for every operation |
| `CREATE SERVICE` | create a model service in that schema |
| `EXECUTE` | query the service |
| `MANAGE` | change it, delete it, and manage its grants |

By default only the owner can query a service they create, so opening it up is a deliberate act: grant `EXECUTE` plus `USE CATALOG` and `USE SCHEMA` to the group that should have it, the same way you would open a table (see [[privileges-grant-revoke]]). Model services run with **definer's privileges**: the owner's permissions are evaluated, not the caller's.

### The services you already have: `system.ai`

Databricks ships ready-to-use model services in the `system.ai` schema, named after the model behind them, for example `system.ai.claude-opus-5` or `system.ai.claude-sonnet-4-5`. All account users hold `EXECUTE` on these by default, so they work with no setup. They are the fastest way to see what the gateway records, and the natural default destination for a service of your own.

### Creating one

Three routes: the Unity Gateway UI (**Create**), Catalog Explorer (**Create** > **Service** > **Model service** inside the target schema), or the Unity Catalog REST API at `/api/2.1/unity-catalog/model-services`, which takes `parent` and `model_service_id` as query parameters. The routing configuration needs at least one destination, each with a `name`, a `destination_type` such as `DESTINATION_TYPE_PAY_PER_TOKEN_FOUNDATION_MODEL`, its type-specific config (`pay_per_token_config` carries the `model`), and a `traffic_percentage`. Destinations can be Databricks-served foundation models, pay-per-token or provisioned throughput, or a model provider service for an external provider.

Creating one requires more than `CREATE SERVICE`: also `EXECUTE` on the models you reference, `EXECUTE` with `USE CATALOG` and `USE SCHEMA` on any model provider service you route to, and `CREATE TABLE` on the target schema if you turn on inference logging.

### Querying one

The gateway exposes provider-neutral paths and native ones side by side.

| Path | API |
| --- | --- |
| `/ai-gateway/mlflow/v1/chat/completions` | MLflow chat completions |
| `/ai-gateway/mlflow/v1/embeddings` | MLflow embeddings |
| `/ai-gateway/openai/v1/responses` | OpenAI Responses |
| `/ai-gateway/anthropic/v1/messages` | Anthropic Messages |
| `/ai-gateway/gemini/v1beta/models/<model-service>:generateContent` | Google Gemini |

Any OpenAI-compatible client works: point `base_url` at `https://<workspace-url>/ai-gateway/mlflow/v1`, pass a Databricks token as the API key, and put the fully qualified service name in the `model` argument. Switching the model behind a service changes nothing in the caller.

One gap to plan around: `ai_query()` support covers only Databricks-provided models, so a model service you create cannot yet be used from SQL batch inference. On the `ai_query()` path only usage tracking applies; rate limits, guardrails, inference tables and fallbacks do not.

### Not the same thing as a serving endpoint

A [[model-serving-endpoints|Model Serving endpoint]] is workspace-scoped compute: it hosts a model or an agent, scales it, and gives it a REST URL. A model service hosts nothing. It is a catalog object that names destinations and routes traffic to them, and its value is the governance and accounting wrapped around that routing. You still need serving endpoints for your own models; the model service is the governed front door in front of them.

### Rate limits

Limits are set in queries per minute (**QPM**) or tokens per minute (**TPM**, model services only) at four scopes: the whole service, a default that applies to every user, specific users or service principals, and user groups. Where several apply, the most restrictive wins. A caller over the limit gets **HTTP 429**, so clients need retries with exponential backoff. A service holds at most 20 rate limits, of which at most 5 can be group-specific.

### Where usage and spend show up

Every request is written to the billable system table **`system.ai_gateway.usage`**, readable by account and metastore admins by default. It carries `endpoint_name` and `endpoint_id`, `event_time`, `latency_ms` and `time_to_first_byte_ms`, `input_tokens`, `output_tokens` and `total_tokens`, `requester` and `requester_type`, `destination_model`, `status_code`, and `request_tags`. Tags are how spend gets attributed to something a finance conversation recognises: send a `Databricks-Ai-Gateway-Request-Tags` header with JSON key-value pairs and they land in `request_tags` for grouping by team, project or environment. Account admins can also generate a ready-made view from **Govern** > **Create Usage Dashboard**. One caveat: token usage is not tracked for non-streaming, non-embedding responses larger than 1 MiB.

## Example: calling a governed service and reading the bill

```python
import json, os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["DATABRICKS_TOKEN"],
    base_url="https://<workspace-url>/ai-gateway/mlflow/v1",
)

reply = client.chat.completions.create(
    model="main.ai.support_llm",  # the model service, not a model name
    messages=[{"role": "user", "content": "Summarise ticket 44812 in two sentences."}],
    extra_headers={
        "Databricks-Ai-Gateway-Request-Tags": json.dumps({"team": "support", "env": "prod"})
    },
)
print(reply.choices[0].message.content)
```

A week later, who spent what:

```sql
SELECT requester,
       destination_model,
       request_tags,
       count(*)          AS requests,
       sum(total_tokens) AS tokens,
       avg(latency_ms)   AS avg_latency_ms
FROM system.ai_gateway.usage
WHERE endpoint_name = 'main.ai.support_llm'
  AND event_time >= current_date() - INTERVAL 7 DAYS
GROUP BY ALL
ORDER BY tokens DESC;
```

## Common mistakes

- **Creating a model service and wondering why the team gets a permission error.** Only the owner can query it until `EXECUTE` is granted, and `USE CATALOG` and `USE SCHEMA` have to come with it.
- **Building SQL batch inference on a custom model service.** `ai_query()` currently accepts only Databricks-provided models, so that pipeline has to call a foundation model endpoint directly for now.
- **Setting a service-wide QPM and calling it done.** One heavy job will still exhaust it for everybody. The per-user default exists precisely to stop that.
- **Not sending request tags.** Without them `system.ai_gateway.usage` tells you which user spent the tokens but not which project, which is the number anyone actually asks for.
- **Treating `system.ai` services as a sandbox.** They are governed like everything else and their usage appears in the same table, so a "quick test" is a line in next month's cost review.

> [!tip]
> Some of what surrounds model services is still moving: service policies, agent services and the unified trace table were in Beta as of September 2026, while model services and the gateway itself are generally available. Build on the governed endpoint and the usage table; treat the rest as a preview of where this is going.
