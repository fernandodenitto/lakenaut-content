---
id: external-models
title: External models and model provider services
area: serving
level: intermediate
summary: Reaching a model Databricks does not host, either as an external model on a serving endpoint or as a model provider service whose credentials and spend live in Unity Catalog.
prerequisites: [model-serving-endpoints, ai-gateway-basics]
related:
  [
    model-services,
    foundation-model-apis,
    secrets-management,
    provisioned-throughput,
    privileges-grant-revoke,
  ]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/machine-learning/foundation-models/external-models/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/ai-gateway/model-provider-services/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/ai-gateway/create-model-provider-services
    checked: 2026-09-12
  - url: https://docs.databricks.com/api/ai-gateway/v1/model-provider-service
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/ai-gateway/cost-observability
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/model-serving/route-optimization
    checked: 2026-09-12
aliases:
  [
    external model,
    external models,
    model provider service,
    openai_config,
    third-party model,
    proxy provider,
    external_model_spend,
  ]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

Databricks has two ways to put a model it does not host behind a Databricks address.

An **external model** is a [[model-serving-endpoints|serving endpoint]] whose served entity is an `external_model` block rather than a registered model: Databricks holds the provider credential, forwards your request to the provider, and returns the answer in the same shape as a Databricks-hosted model. Nothing runs on Databricks compute except the proxy.

A **model provider service** is the same idea moved into the catalog. It is a Unity Catalog securable with a three-level name, such as `main.default.openai_prod`, holding the provider type, the connection details and the encrypted credential. It hosts nothing and answers nothing on its own: a [[model-services|model service]] names it as a destination, and the credential is never handed to the caller. The external-models documentation now points at it for anything that needs to be queried across workspaces or have spend tracked against it.

## Why it exists

The default way to call OpenAI or Anthropic from a notebook is an API key in the environment, and that key then spreads. It ends up in a job definition, a second workspace, someone's laptop, and a repository history. Nobody can answer which jobs use it, nobody can revoke it for one team without breaking the others, and the provider's invoice arrives as one number for the whole organisation.

External models fixed the first half of that: one place holds the key, and the calling code stops carrying it. What they did not fix is that a serving endpoint belongs to one workspace, so an organisation with several workspaces still had several copies of the same credential and no combined view of spend. Making the provider a catalog object closes that: define it once in the metastore, grant it like a table, and every attached workspace uses the same object under the same grants.

## How it works

### Which providers

Both paths cover the mainstream providers, with different names for them.

| External model `provider`  | Model provider service `provider_type`           | Credential                                           |
| -------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| `openai`                   | `EXTERNAL_MODEL_PROVIDER_TYPE_OPENAI`            | API key                                              |
| `openai` (Azure variant)   | `EXTERNAL_MODEL_PROVIDER_TYPE_AZURE_OPENAI`      | API key or a Microsoft Entra ID service principal    |
| `anthropic`                | `EXTERNAL_MODEL_PROVIDER_TYPE_ANTHROPIC`         | API key                                              |
| `amazon-bedrock`           | `EXTERNAL_MODEL_PROVIDER_TYPE_AMAZON_BEDROCK`    | AWS access key pair or a service credential          |
| `google-cloud-vertex-ai`   | `EXTERNAL_MODEL_PROVIDER_TYPE_GEMINI_ENTERPRISE` | API key with project and region                      |
| `cohere`                   | not listed                                       | API key                                              |
| `custom`                   | `EXTERNAL_MODEL_PROVIDER_TYPE_CUSTOM`            | bearer token or a named HTTP header, plus a base URL |
| `databricks-model-serving` | not applicable                                   | a Databricks token                                   |
| not applicable             | `EXTERNAL_MODEL_PROVIDER_TYPE_MICROSOFT_FOUNDRY` | API key or Entra ID service principal                |

The `custom` type is the escape hatch for anything that speaks an OpenAI-compatible API, including a model you host yourself.

### Where the credential lives

On an external model endpoint, the provider config field takes either a Databricks secret reference in the form `{{secrets/<scope>/<key>}}` or the value inline through a field whose name ends in `_plaintext`. Databricks encrypts what you give it and deletes it when the endpoint is deleted. A secret reference is the better habit, because rotating the secret does not mean editing the endpoint. See [[secrets-management]].

A model provider service takes the credential inline at creation and encrypts it into the catalog object, or takes a reference to an existing service credential for Bedrock and Azure. Two things are immutable afterwards: the provider type, and the choice between a service credential and an access key pair. Changing either means a new object.

### Privileges, and the allowlist

Creating a model provider service needs `CREATE SERVICE` on the target schema with `USE SCHEMA` and `USE CATALOG` above it, plus `CREATE CONNECTION` when you supply the credential inline and `ACCESS` on any service credential you reference. Querying through it needs `EXECUTE`; editing or deleting needs `MANAGE`, the same grammar as the rest of [[privileges-grant-revoke|Unity Catalog privileges]].

The `targets` array is the part worth designing rather than accepting. Each entry allowlists one upstream model and the native API shapes it may be reached through, for example `openai/v1/chat/completions`. `allow_all_targets` turns the allowlist off. An allowlist is how you stop a governed provider object from becoming an unrestricted passthrough to everything that provider sells.

### Fan-out and fan-in

One provider service backs many model services, which is why a single `openai_prod` object can sit under a dozen governed endpoints. A single model service can also reference several provider services at once, which is what makes a traffic split or a failover between two providers a configuration change rather than a code change.

### Where the money shows up

Databricks-hosted models bill as DBUs in `system.billing.usage`. External providers bill you directly, so Databricks estimates instead: `system.ai_gateway.external_model_spend` aggregates hourly, with `usage_quantity` as an estimated amount in USD computed from the provider's published prices, and `pricing_metadata` recording which tier the price came from. It is explicitly informational, it does not cover the `custom` provider because there are no published prices to apply, and the provider's own invoice remains the authoritative number. Unity Gateway budgets can include external model usage so an alert fires against a threshold.

## Example: a provider object, then a governed call

```python
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()

# The credential is encrypted into the catalog object. Callers never see it.
w.api_client.do(
    "POST",
    "/api/2.1/unity-catalog/model-provider-services",
    query={"parent": "main.default", "model_provider_service_id": "openai_prod"},
    body={
        "config": {
            "provider_type": "EXTERNAL_MODEL_PROVIDER_TYPE_OPENAI",
            "openai": {"api_key": {"plaintext": "<key>"}},
            "targets": [
                {"model": "gpt-5-mini", "native_api_types": ["openai/v1/chat/completions"]}
            ],
        }
    },
)
```

The equivalent as an external model on a serving endpoint, with the key as a secret reference rather than inline:

```python
w.serving_endpoints.create(
    name="openai-chat",
    config={
        "served_entities": [
            {
                "external_model": {
                    "name": "gpt-5-mini",
                    "provider": "openai",
                    "task": "llm/v1/chat",
                    "openai_config": {
                        "openai_api_key": "{{secrets/llm/openai_api_key}}"
                    },
                }
            }
        ]
    },
)
```

Estimated spend per provider, a week later:

```sql
SELECT usage_metadata.provider,
       usage_metadata.model,
       identity_metadata.run_by,
       sum(usage_quantity) AS estimated_usd
FROM system.ai_gateway.external_model_spend
WHERE usage_start_time >= current_timestamp() - INTERVAL 30 DAYS
GROUP BY ALL
ORDER BY estimated_usd DESC;
```

## When routing through Databricks is worth it

It earns its place when more than one thing calls the model. One credential with an owner and a grant, one rate limit, one usage table that says which team spent what, and one name in the caller's code that you can repoint at a different provider without a deployment. It also earns its place when the endpoint should be visible to a security review next to the data it will read, and when several workspaces need the same access.

Calling the provider directly is still the honest answer for a single application with a single key, especially on a tight latency budget: the proxy is another network hop, and for external models you cannot buy it back with route optimisation, which supports only custom model serving and feature serving endpoints. Go direct too when you depend on a provider parameter or endpoint the gateway does not pass through yet, and when you need exact costs rather than an estimate, since the spend table is derived from published list prices.

One constraint applies whichever way you go: routing to an external provider can mean your data is processed outside the region it originated in, and that is a residency question the gateway does not answer for you.

## Common mistakes

- **Using `_plaintext` fields because the documentation shows them.** They work, and they put the key in whatever created the endpoint. Use a secret reference or a service credential so rotation is one edit in one place.
- **Leaving `allow_all_targets` on.** A governed provider with no allowlist governs the credential and nothing else: any model that provider sells is now reachable through it.
- **Treating `external_model_spend` as a bill.** It is an estimate from published prices, it is hourly, and it says nothing about the `custom` provider. Reconcile against the provider's invoice before anyone budgets from it.
- **Building a new integration on an external model endpoint when it needs to be shared.** The endpoint is workspace-scoped, so the second workspace means a second copy of the credential. A model provider service exists for that case.
- **Expecting route optimisation to rescue the latency.** It is not supported for external models, so the extra hop is the price of the governance.
