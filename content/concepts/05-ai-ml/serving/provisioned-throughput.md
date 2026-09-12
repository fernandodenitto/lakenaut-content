---
id: provisioned-throughput
title: "Paying for a foundation model: tokens, units and reservations"
area: serving
level: intermediate
summary: "The four capacity modes for a Databricks-hosted foundation model: pay-per-token, priority, on-demand provisioned throughput and reserved provisioned throughput, and how to size model units."
prerequisites: [foundation-model-apis, model-serving-endpoints]
related:
  [
    foundation-model-apis,
    model-serving-endpoints,
    serving-compute-and-scaling,
    model-services,
    external-models,
  ]
exams:
  - cert: genai-engineer-associate
    domain: "Assembling and Deploying Applications"
    objective: "Identify how to serve an LLM application on Foundation Model APIs and choose the capacity mode it needs."
sources:
  - url: https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/deploy-prov-throughput-foundation-model-apis
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/model-units
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/reserved-provisioned-throughput
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/priority-mode
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/limits
    checked: 2026-09-12
aliases:
  [
    provisioned throughput,
    model units,
    pay-per-token,
    priority mode,
    service_tier,
    reserved capacity,
    tokens per second,
    provisioned_model_units,
  ]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

A Databricks-hosted foundation model is billed in one of four ways, and the choice is a capacity decision rather than a model decision: the same model can usually sit behind more than one of them. **Pay-per-token** draws on a shared pool and charges per input and output token. **Priority pay-per-token** buys a place ahead of that queue, decided per request. **On-demand provisioned throughput** allocates dedicated capacity with no term commitment. **Reserved provisioned throughput** prepays a pool of capacity for a fixed one- or three-month term.

[[foundation-model-apis]] covers what the models are and how to call them. This page is about what you pay for, in what unit, and how much of it to buy.

## Why it exists

A shared pool is the right default and the wrong production answer. It costs nothing when idle, needs no sizing decision, and it is best-effort: every other workload in the region is in the same queue, so the latency you measure in a demo is not the latency you get on the day a batch job and a customer-facing agent run at once. The rate limits are per workspace, so the first sign of trouble is usually an HTTP 429 rather than a slow response.

Provisioned throughput turns that into capacity you own: a fixed amount of work per minute, not shared, priced on what you allocated rather than on what your users typed. The two variants answer different questions, on-demand for traffic that is real but still changing, reserved for traffic you can forecast and want at a lower unit price.

## How it works

### The four modes side by side

| Mode                             | Capacity                                   | Billed on                   | Fits                                         |
| -------------------------------- | ------------------------------------------ | --------------------------- | -------------------------------------------- |
| Pay-per-token                    | shared, best-effort                        | input and output tokens     | prototypes, spiky or low-volume traffic      |
| Priority pay-per-token           | shared, admitted ahead of standard traffic | tokens, at a premium rate   | latency-sensitive calls without a commitment |
| On-demand provisioned throughput | dedicated, no commitment                   | allocated capacity per hour | production traffic you cannot yet forecast   |
| Reserved provisioned throughput  | dedicated, prepaid                         | the full 1- or 3-month term | business-critical, predictable traffic       |

Priority mode is set per request with `service_tier` as `"priority"`, so one application can send interactive calls at the priority rate and background calls at the standard rate against the same endpoint. It is a promise about admission, not a latency number: Databricks describes the target as availability, meaning successful requests over admitted requests, being more consistent than standard pay-per-token under load. If the priority pool itself is fully subscribed, the request falls back to standard pay-per-token pricing.

Pay-per-token limits are worth reading before you decide you don't need dedicated capacity. On the Enterprise tier most models cap input tokens per minute (ITPM) at 200,000 and output tokens per minute (OTPM) at 20,000, with queries per hour (QPH) commonly at 360,000, and the most restrictive of the three applies at any moment. If you send `max_tokens`, Databricks reserves that much output capacity before admitting the request and credits back whatever you don't use, so an over-generous `max_tokens` throttles you for output you never generate.

### Capacity is expressed in model units now

The unit changed. Older model families were provisioned as a **tokens-per-second band**, set with `min_provisioned_throughput` and `max_provisioned_throughput`. Current families are provisioned in **model units**, a measure of how much work the endpoint can do per minute, set with `provisioned_model_units`. The families still on tokens per second are the legacy ones: Meta Llama 3.3, 3.2, 3.1 and 3, Llama 2, GTE v1.5 and BGE v1.5 (English), DeepSeek R1, DBRX, Mistral, Mixtral and MPT.

Model units do not convert to tokens per second at a fixed rate, and that is the point. Generating output tokens costs more than reading input tokens, and the work per request grows non-linearly with both counts, so the same allocation serves either many short requests or a smaller number of long-context ones. The documentation's worked figure: Llama 4 Maverick at 50 model units delivers roughly 3,250 tokens per second on a medium shape of 3,500 input and 300 output tokens.

Which unit a given model uses is not worth guessing. Ask the API:

```python
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
info = w.api_client.do(
    "GET",
    "/api/2.0/serving-endpoints/get-model-optimization-info/system.ai.gpt-oss-120b/1",
)
# optimizable: can this model take provisioned throughput at all
# model_unit_chunk_size: the increment, for model-unit models
# throughput_chunk_size: the increment in tokens per second, for legacy models
print(info)
```

### Sizing it

For reserved capacity the Serving page has an estimator: give it the average input and output tokens per request, the number of concurrent requests you expect and your expected cache hit rate, and it returns the model units to buy. Cache hit rate belongs in that calculation because a cached prefix is work the endpoint does not repeat.

There is no equivalent shortcut for a shape you cannot describe. If your request mix is unknown, allocate a chunk, load test at the shape you actually serve, and grow from there. Provisioned throughput endpoints autoscale within the range you set, so the useful decision is the floor: enough units that your baseline never queues.

### Reserved capacity, and what happens when it lapses

A reservation is a prepaid pool of model units on one foundation model, for one or three months, with the longer term priced lower per unit. You need `MANAGE` on the foundation model in Unity Catalog to set one up, and eligibility is per model: as of September 2026 the documentation lists reserved provisioned throughput for Zhipu AI GLM 5.2.

Reservations stack rather than replace: scaling up creates a second one on top of the first, each with its own expiry, listed separately on the endpoint detail page. At expiry the pool lapses and the endpoint carries on over priority pay-per-token. That is a fallback, not an outage, and also a silent change to both your cost per token and your capacity guarantee, so the renewal date belongs in a calendar.

## Example: an on-demand provisioned throughput endpoint

```python
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()

# Model-unit models post to /pt, not to the general serving-endpoints path.
w.api_client.do(
    "POST",
    "/api/2.0/serving-endpoints/pt",
    body={
        "name": "support-llm-pt",
        "config": {
            "served_entities": [
                {
                    "entity_name": "system.ai.gpt-oss-120b",
                    "entity_version": "1",
                    "provisioned_model_units": 4,
                }
            ]
        },
    },
)
```

A legacy family takes a band in tokens per second and the ordinary path instead, with `min_provisioned_throughput` and `max_provisioned_throughput` as multiples of the `throughput_chunk_size` the optimization-info call returned.

## Common mistakes

- **Reading provisioned throughput as "unlimited".** Provisioned throughput endpoints are still capped at 200 QPS per workspace, and per-request output has a ceiling that depends on the model, from 8,192 tokens on some families to 25,000 on others.
- **Converting model units to tokens per second with a single multiplier.** The relationship depends on the input and output shape of your requests, so a number measured on 300-token answers will not hold for long-context summarisation.
- **Buying a reservation before you have measured a week of traffic.** On-demand has no commitment precisely so that you can size the reservation from real numbers instead of a guess.
- **Letting a reservation expire unnoticed.** The endpoint keeps answering on priority pay-per-token, which means no alert fires and the first evidence is the invoice.
- **Registering a base model and expecting it to deploy.** Base versions of the Meta Llama models cannot be deployed from Unity Catalog for provisioned throughput; the Instruct variants can.
- **Treating a creation timeout as a configuration error.** Provisioned throughput needs GPUs, and deployment can fail on capacity, which surfaces as a timeout on endpoint creation rather than a validation message.

> [!exam]
> Know the four modes by name and what each one guarantees: pay-per-token is shared and best-effort, priority is per-request admission set with `service_tier` as `"priority"`, on-demand provisioned throughput is dedicated with no commitment, and reserved is prepaid for one or three months. Know that current models are sized in **model units** while the legacy families are still sized as a tokens-per-second band, and that `429` from a pay-per-token endpoint is a workspace rate limit rather than a broken request. The distinction that catches people: provisioned throughput buys capacity, not latency, and it does not remove the per-workspace QPS ceiling.
