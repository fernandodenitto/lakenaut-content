---
id: foundation-model-apis
title: Foundation Model APIs
area: playground
level: intermediate
summary: Foundation Model APIs serve chat and embedding models as Databricks-hosted endpoints, pay-per-token or with provisioned throughput, callable from Python, SQL, or an OpenAI-compatible client.
prerequisites: [ai-playground, model-serving-endpoints]
related: [ai-gateway-basics, model-serving-endpoints, agent-framework, rag-pipeline]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/
    checked: 2026-09-10
aliases: [fmapi, foundation model api, pay-per-token, provisioned throughput]
updated: 2026-09-10
status: published
---

## What it is

**Foundation Model APIs** are Databricks-hosted [[model-serving-endpoints]] for a curated set of chat and embedding models, reachable the moment your workspace is created — no deployment step, no GPU to provision. They come in two billing modes, **pay-per-token** and **provisioned throughput**, and can be called from Python, from SQL, or from any client that already speaks the OpenAI API shape.

## Why it exists

Every team that needs an LLM either calls a third-party API directly — scattering provider credentials across notebooks and jobs — or stands up its own serving infrastructure for an open model, which is undifferentiated work most teams shouldn't own. Foundation Model APIs put curated models inside the workspace's own governance and region boundary, billed per use from day one, so a team can start calling a model in minutes and only think about dedicated capacity once traffic is real and predictable.

## How it works

### Pay-per-token vs. provisioned throughput

| | Pay-per-token | Provisioned throughput |
| --- | --- | --- |
| Capacity | shared, best-effort (an optional priority tier exists for latency-sensitive calls) | dedicated, reserved in throughput units |
| Billing | per input/output token | per hour of reserved capacity, on-demand or under a 1–3 month commitment |
| Fits | prototyping, spiky or low-volume traffic | production traffic, fine-tuned or custom base models, latency guarantees |

### Which models

The pay-per-token catalog is a curated set of open-weight chat models (the Llama family, Databricks' own DBRX) and embedding models (GTE, BGE); provisioned throughput extends to models you've fine-tuned or imported yourself. The exact roster changes as new models ship, so treat the supported-models page as the source of truth rather than any fixed list.

### Calling with an OpenAI-compatible client

Because the request and response shape matches the OpenAI chat-completions API, the official `openai` Python client works unmodified against a Databricks endpoint — you only swap the base URL and the token:

```python
from openai import OpenAI

client = OpenAI(
    api_key=dbutils.secrets.get("fmapi", "token"),
    base_url="https://<workspace-host>/serving-endpoints",
)

response = client.chat.completions.create(
    model="databricks-meta-llama-3-1-8b-instruct",
    messages=[{"role": "user", "content": "Summarize this incident report in two sentences."}],
)
```

### Calling from SQL with ai_query

`ai_query()` calls the same endpoints directly from a warehouse query, so a SQL-only user can score or transform rows without a notebook:

```sql
SELECT
  ticket_id,
  ai_query('databricks-meta-llama-3-1-8b-instruct', request => summary_text) AS short_summary
FROM support.raw.tickets;
```

### External models: proxying other providers

**External models** are a related but distinct idea: a serving endpoint configured to forward calls to a third-party provider — OpenAI, Anthropic, and others — using credentials Databricks stores as a secret. Databricks doesn't host the weights; it standardizes the interface and the credential handling, so calling an external GPT model and calling a Databricks-hosted Llama model look identical from your code.

### Rate limits, region, and cost

Pay-per-token endpoints carry default rate limits (queries and tokens per minute) shared across the workspace; a burst of concurrent jobs can hit a `429` well before any single job feels "slow." Provisioned throughput sidesteps shared limits by reserving fixed capacity, billed whether or not it's fully used. Both modes are available only in specific cloud regions, and the two lists don't always match — check availability before assuming a second workspace can reach the same model.

## Common mistakes

- Assuming pay-per-token capacity scales with need; a shared limit means one noisy job can starve every other caller in the workspace.
- Discovering the hourly bill for provisioned throughput only after the endpoint sat idle over a weekend.
- Hardcoding a third-party API key in a notebook instead of registering it once as an external model behind a Databricks secret.
- Deploying to a new region and finding the model you relied on isn't available there.

> [!tip]
> Reach for pay-per-token by default; move a specific endpoint to provisioned throughput only when you can point to a latency SLA or a fine-tuned model that requires it — not as a blanket precaution.
