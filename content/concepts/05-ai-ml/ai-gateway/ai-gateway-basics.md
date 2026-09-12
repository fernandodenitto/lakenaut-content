---
id: ai-gateway-basics
title: Unity Gateway (formerly AI Gateway)
area: ai-gateway
level: intermediate
summary: "The governance layer in front of every model call: model services as Unity Catalog securables, rate limits, usage attribution, service policies and one address per provider dialect."
prerequisites: [model-serving-endpoints, unity-catalog-overview]
related: [model-services, foundation-model-apis, mlflow-tracing, model-serving-endpoints, privileges-grant-revoke]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/ai-gateway/
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/ai-gateway/model-services/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/service-policies/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/ai-gateway/unified-trace-table
    checked: 2026-09-11
aliases: [unity gateway, unity ai gateway, mosaic ai gateway, ai gateway, model gateway, llm gateway]
updated: 2026-09-11
status: published
---

## What it is

**Unity Gateway** (called Mosaic AI Gateway, then Unity AI Gateway, before August 2026) is a governance layer that sits in front of a [[model-serving-endpoints|serving endpoint]] — whether it serves a Databricks-hosted foundation model, an external model, or your own custom model — so that every caller goes through the same governed door instead of reaching the model directly.

## Why it exists

Once more than one team calls a model, someone eventually has to answer questions nobody designed for: who is spending the token budget, did a prompt leak a customer's PII, what happens to the application when the provider has an outage. Solving that per-team, per-endpoint means as many inconsistent answers as there are teams. Unity Gateway configures usage tracking, rate limits, guardrails, and fallback once, on the endpoint itself, using the same [[unity-catalog-overview|Unity Catalog]] privilege model already used to govern tables — so putting a model in front of users doesn't mean inventing a second permission system.

## How it works

### Model services, not endpoint settings

The gateway used to be a set of options you turned on for one serving endpoint at a time. Since it went generally available in August 2026 the unit has changed: a **model service** is a governed model endpoint that is itself a Unity Catalog securable, with a three-level name, an owner and grants, exactly like a table. Databricks ships a set of them ready to use under `system.ai`, and you create your own for the models your organisation exposes. [[model-services]] covers creating and querying them.

The older per-endpoint configuration still works and the documentation now marks it legacy. If you inherit code calling `put_ai_gateway` on a serving endpoint, it is that path.

### One address for every model

A model service answers on the gateway's own routes rather than on a per-endpoint URL, and it speaks more than one dialect: an MLflow path, an OpenAI-compatible path, and an Anthropic-compatible path. That is what lets you move a workload from one provider to another without rewriting the client, which was the original argument for putting a gateway in front of anything.

### Limits, and who pays

Rate limits are set in queries per minute and tokens per minute, and they apply at several scopes at once: the service as a whole, a default for every caller, and overrides for a named user, service principal or group. A caller over the limit gets a `429` rather than a surprise on the invoice.

Usage lands in `system.ai_gateway.usage`, one row per request, which is what turns "the AI line on the bill" into an answer about which team spent it. A request can carry tags in a header so the attribution survives into the system table, which matters when one application serves several internal customers.

### Policies, which replaced guardrails

Content controls are no longer a checkbox on the endpoint. They are **service policies**: rules attached to the AI securable and evaluated when a request is made and again when the answer comes back, returning allow, deny or ask. Databricks provides judges to call, among them `system.ai.block_unsafe_content`, `system.ai.block_jailbreak` and `system.ai.detect_sensitive_data`, and you can write your own condition in SQL.

Two properties are worth knowing before you turn them on. They fail closed, so a policy that cannot be evaluated blocks the call rather than waving it through. And there is a log-only mode, which is how you find out what a policy would have blocked before it starts blocking it for real.

> [!note]
> Service policies are in Beta as of September 2026, as is the unified trace table below. Unity Gateway itself is generally available; its newer capabilities are enabled separately.

### Seeing what happened

Two layers of record, for two different questions. `system.ai_gateway.usage` answers "how much, by whom". The **unified trace table** answers "what exactly was asked and answered": every request and response across the gateway in one Unity Catalog table, in OpenTelemetry format, which is the same shape [[mlflow-tracing]] writes for an application you instrument yourself.

### External providers

A model that is not hosted by Databricks is reached through a **model provider service**: a securable holding the provider credentials, encrypted, so an API key lives in Unity Catalog rather than in a notebook or a job's environment. Spend against external providers is tracked separately, which is the only practical way to answer what a third-party model is costing.

## Example: what a governed call looks like

```sql
-- Usage is attributed per request, so the bill can be split by team.
SELECT team, SUM(total_tokens) AS tokens, COUNT(*) AS requests
FROM system.ai_gateway.usage
WHERE request_time >= current_date() - INTERVAL 30 DAYS
GROUP BY team
ORDER BY tokens DESC;
```

```python
# The gateway speaks an OpenAI-compatible dialect, so an existing client needs a base URL,
# not a rewrite. The model name is the three-level Unity Catalog name of the service.
from openai import OpenAI
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
client = OpenAI(api_key=w.config.token, base_url=f"{w.config.host}/ai-gateway/openai/v1")

answer = client.responses.create(
    model="main.ai.support_assistant",
    input="Summarise this ticket in one sentence.",
)
```

## Common mistakes

- **Treating the gateway as optional until the bill arrives.** Retrofitting limits and attribution onto an endpoint that three teams already depend on is a harder conversation than setting them up first.
- **Setting only a service-wide rate limit.** One heavy caller then starves everyone else inside the limit. The per-caller default exists for exactly that.
- **Turning on a policy without log mode.** A sensitive-data policy that has never been measured against real prompts will block legitimate work on its first day, and nobody will trust it afterwards.
- **Keeping provider keys in notebooks because the gateway "is for Databricks models".** Model provider services exist so an external key is a governed object with an owner, not a string in a job definition.
- **Reading a Beta label as a soft GA.** Service policies and the unified trace table are Beta: useful to pilot, not something to put a compliance commitment on.

> [!tip]
> Govern before you announce. The order that works is: create the service, set limits, turn policies on in log mode, read a week of usage, then hand out the name.
