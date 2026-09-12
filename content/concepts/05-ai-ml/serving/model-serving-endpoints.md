---
id: model-serving-endpoints
title: Model serving endpoints
area: serving
level: intermediate
summary: A serving endpoint puts a custom or foundation model behind a REST API with autoscaling, traffic splitting, and built-in request logging.
prerequisites: [models-in-uc, compute-options]
related: [mlflow-tracking, feature-engineering, jobs-triggers, runs-monitoring]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/machine-learning/model-serving/
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/machine-learning/model-serving/create-manage-serving-endpoints
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/machine-learning/model-serving/inference-tables
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/ai-gateway/
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/sql/language-manual/functions/ai_query
    checked: 2026-09-10
aliases: [serving endpoint, real-time inference, scale to zero, inference table, AI Gateway, Unity Gateway, ai_query]
updated: 2026-09-11
status: published
---

## What it is

A **serving endpoint** is a managed REST API in front of one or more models: a custom model version from [[models-in-uc]] packaged with MLflow, or a foundation model, either Databricks-hosted or from an external provider such as OpenAI. Databricks runs the serverless compute behind it, exposes `POST /serving-endpoints/<name>/invocations`, and reports latency and throughput without you provisioning a single VM.

## Why it exists

A trained model sitting in the registry is not useful to an application until something can call it with sub-second latency, scale that capacity up and down with demand, and log every request for later debugging. Building and operating that yourself — a web server, an autoscaler, a request logger, a way to compare two model versions live — is a lot of undifferentiated infrastructure for every team to reinvent; the endpoint gives it to you as configuration.

## How it works

### Custom models vs. foundation models

A **custom model endpoint** loads a specific version of a model registered in [[models-in-uc]] and runs your `predict()` code. A **foundation model endpoint** points at a chat or embedding model instead, either pay-per-token or with provisioned throughput, and speaks the same invocation format regardless of the underlying provider — the calling code doesn't change if you switch models behind it.

### Traffic splitting for A/B and canary

An endpoint can host several **served entities** at once, each a specific model version, and a `traffic_config` that assigns each one a percentage of incoming requests, e.g. 90% to the current champion and 10% to a challenger. You update the split with a config call, no redeploy needed, which is what makes canary rollouts and A/B tests operationally cheap. To test one version in isolation, you can call it directly by name, bypassing the split entirely.

### Scale to zero

Compute scale-out is sized by expected concurrency (roughly `QPS × model runtime`), and an endpoint can be configured to scale down to zero replicas when idle to cut cost. The tradeoff is a **cold start**: the next request after idling pays the latency of spinning compute back up, which is why scale to zero is discouraged for endpoints with a production latency SLA.

### Inference tables

Turning on **inference tables** makes the endpoint log every request and response as rows in a Unity Catalog Delta table, alongside status codes and timing. Joined later with ground-truth labels, that table becomes both a monitoring feed for drift and quality, and a source of new training data — closing the loop back to [[mlflow-tracking]] and [[feature-engineering]].

### Rate limits and Unity Gateway

**Unity Gateway** (formerly AI Gateway), also built on Unity Catalog, sits in front of serving endpoints (and external model providers) to enforce per-user or per-team rate limits, apply content-filtering guardrails, add fallback across providers, and record usage — tokens, requests, latency — in system tables for cost attribution.

### Querying from SQL with ai_query

`ai_query()` calls any serving endpoint directly from a SQL statement, so a warehouse query can score rows in place instead of exporting them to a notebook:

```sql
SELECT
  customer_id,
  ai_query(
    'churn-endpoint',
    request => named_struct('orders_30d', orders_30d, 'avg_order_value_30d', avg_order_value_30d),
    returnType => 'BOOLEAN'
  ) AS predicted_churn
FROM shop.features.customer_30d;
```

## Example

```python
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import EndpointCoreConfigInput, ServedEntityInput, TrafficConfig, Route

w = WorkspaceClient()

w.serving_endpoints.create(
    name="churn-endpoint",
    config=EndpointCoreConfigInput(
        served_entities=[
            ServedEntityInput(name="champion", entity_name="shop.ml.churn_model", entity_version="7", workload_size="Small", scale_to_zero_enabled=False),
            ServedEntityInput(name="challenger", entity_name="shop.ml.churn_model", entity_version="8", workload_size="Small", scale_to_zero_enabled=False),
        ],
        traffic_config=TrafficConfig(routes=[Route(served_model_name="champion", traffic_percentage=90), Route(served_model_name="challenger", traffic_percentage=10)]),
    ),
)
```

## Common mistakes

- Enabling scale to zero on an endpoint that a real-time application depends on, then blaming "random" latency spikes on the model instead of on cold starts.
- Never turning on inference tables, so the first time predictions look wrong there's no request history to debug from.
- Splitting traffic for a canary but never checking the challenger's metrics anywhere, which makes the split cosmetic rather than an actual experiment.
- Calling a foundation model endpoint directly from every notebook and job with no Unity Gateway rate limit in front of it, until one runaway job exhausts the shared quota for everyone else.

> [!tip]
> Treat `ai_query` as the bridge between SQL-first analysts and models built by the ML team: a warehouse user can score a table without ever opening a notebook, as long as the endpoint and its permissions already exist.
