---
id: serving-compute-and-scaling
title: Serving compute and scaling
area: serving
level: advanced
summary: "Sizing a custom model endpoint: workload size and type including the GPU options, scale to zero and its cold start, provisioned concurrency from target QPS and latency, and route optimisation."
prerequisites: [model-serving-endpoints, models-in-uc]
related:
  [
    model-serving-endpoints,
    provisioned-throughput,
    compute-options,
    runs-monitoring,
    serverless-compute,
  ]
exams:
  - cert: ml-associate
    domain: "Model Deployment"
    objective: "Deploy a custom model to a model endpoint and size its compute for real-time inference."
sources:
  - url: https://docs.databricks.com/aws/en/machine-learning/model-serving/custom-models
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/model-serving/production-optimization
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/model-serving/create-manage-serving-endpoints
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/model-serving/route-optimization
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/model-serving/model-serving-limits
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/model-serving/glossary
    checked: 2026-09-12
aliases:
  [
    workload size,
    workload type,
    provisioned concurrency,
    scale to zero,
    cold start,
    route optimization,
    route optimisation,
    GPU_SMALL,
    GPU_LARGE,
  ]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

Every custom model [[model-serving-endpoints|serving endpoint]] has four settings that decide what it costs and how it behaves under load: the hardware it runs on (`workload_type`), how much of that hardware it gets (`workload_size`, or `min_provisioned_concurrency` and `max_provisioned_concurrency`), whether it is allowed to idle down to nothing (`scale_to_zero_enabled`), and whether requests take an optimised network path to it (`route_optimized`).

This is the sizing story for a model you trained and registered in [[models-in-uc]]. A Databricks-hosted foundation model is sized in a different currency; see [[provisioned-throughput]].

## Why it exists

Serving is serverless, which removes the cluster but not the arithmetic. The endpoint still has a finite number of concurrent requests it can hold, and everything above that number queues. Autoscaling covers gradual change, but it cannot cover a spike, because detecting load and starting capacity both take time that the request in flight does not have.

The sizing settings are the part you decide in advance: a floor high enough that normal traffic never queues, a ceiling that caps the bill, and hardware that fits the model in memory. Get them wrong and it surfaces as latency nobody can reproduce.

## How it works

### Workload type: the hardware

`workload_type` names the instance family, with memory quoted per unit of concurrency.

| `workload_type`   | Hardware | Memory per concurrency |
| ----------------- | -------- | ---------------------- |
| `CPU`             | CPU      | 4 GB                   |
| `CPU_MEDIUM`      | CPU      | 8 GB                   |
| `CPU_LARGE`       | CPU      | 16 GB                  |
| `GPU_SMALL`       | 1 x T4   | 16 GB                  |
| `GPU_MEDIUM`      | 1 x A10G | 24 GB                  |
| `MULTIGPU_MEDIUM` | 4 x A10G | 96 GB                  |
| `GPU_MEDIUM_8`    | 8 x A10G | 192 GB                 |
| `GPU_LARGE`       | 1 x L40  | 48 GB                  |

`GPU_LARGE` is in **Beta** as of September 2026 and is available only in `ap-northeast-1`, `ap-northeast-2`, `us-east-1`, `us-east-2`, `us-west-2` and `eu-central-1`. Treat it as something to pilot, not to design a region strategy around.

GPU endpoints behave differently in ways that matter operationally: the container takes longer to build, and a build over 60 minutes fails the deployment as a timeout; autoscaling is slower than on CPU; cold starts are longer; and a very large model can fail with `No space left on device`. On GPU the number of replicas is the concurrency value divided by four.

### Workload size, or provisioned concurrency

Two ways to express capacity, and they are alternatives rather than layers.

`workload_size` is the coarse one: `Small` covers 0 to 4 concurrent requests, `Medium` 8 to 16, `Large` 16 to 64. The documentation's rule of thumb is that it should be roughly equal to QPS multiplied by model run time.

`min_provisioned_concurrency` and `max_provisioned_concurrency` are the precise one, and what you want for anything with a latency target. Values must be multiples of 4, and do not set them alongside `workload_size`.

### The arithmetic

Provisioned concurrency is the number of requests the endpoint can hold in parallel, so the sizing is Little's law:

```
required concurrency = target QPS x average latency in seconds
```

100 QPS against a model that answers in 200 ms needs 20 units of concurrency, which is already a multiple of 4. If that same model slows to 400 ms under a bigger payload, the same 100 QPS needs 40, which is why the latency in the formula has to be measured at the shape you actually serve rather than at the shape in your smoke test.

Set `min_provisioned_concurrency` from baseline plus the bursts you see routinely, not from the average: scaling up is immediate on demand but still has to notice the demand first. Scale-down moves in five-minute intervals, so a short trough does not cost you a cold replica. On the client, pair the floor with exponential backoff and pooled connections; the Databricks SDK pools them for you.

The ceilings: 1,024 provisioned concurrency per model (with the custom option and route optimisation), 4,096 per workspace, and 1,000 endpoints per workspace. Utilisation above roughly 80% is the point at which queueing starts to show in P99.

### Scale to zero, and what it costs

`scale_to_zero_enabled` lets an idle endpoint drop to no capacity after 30 minutes of inactivity. The next request pays a cold start, typically 10 to 20 seconds while the model is downloaded and health-checked, and that figure carries no SLA. Capacity is not guaranteed while the endpoint is at zero.

That makes it right for a development or staging endpoint and wrong for anything with a user waiting. The failure mode is easy to misread: latency is fine all day and terrible first thing in the morning, which looks like a model problem and is a scheduling problem.

### Route optimisation

`route_optimized` puts requests on a shorter network path to the endpoint, cutting overhead latency to under 20 milliseconds and lifting the throughput ceiling from 200 QPS, which is described as suitable only for small development use, to 300,000 QPS per endpoint and per workspace.

The restrictions are firm. It can only be turned on **when the endpoint is created**, so an endpoint you may ever want to scale should be created with it. It works only for custom model serving and feature serving endpoints, not for Foundation Model APIs and not for external models. And the only supported authentication is a Databricks OAuth token: personal access tokens do not work, and the query URL is different from the ordinary one, so clients need changing as well as the endpoint.

### Two limits that bite late

A request may spend at most 597 seconds executing the model. Payloads are capped at 16 MB, and 4 MB for agent endpoints. Separately, anything over 1 MB is not logged, so a large request can succeed and leave no trace to debug from.

## Example: a GPU endpoint sized from a latency target

```python
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import EndpointCoreConfigInput, ServedEntityInput

w = WorkspaceClient()

# 60 QPS at a measured 350 ms means 21 concurrent requests; round up to 24.
w.serving_endpoints.create(
    name="ranker",
    config=EndpointCoreConfigInput(
        served_entities=[
            ServedEntityInput(
                name="ranker-v12",
                entity_name="shop.ml.ranker",
                entity_version="12",
                workload_type="GPU_MEDIUM",
                min_provisioned_concurrency=24,
                max_provisioned_concurrency=48,
                scale_to_zero_enabled=False,
            )
        ]
    ),
    route_optimized=True,  # only possible now, not on a later update
)
```

Expect the endpoint to take around 10 minutes to come up, longer for a GPU container. Updating a live endpoint is zero-downtime: the old configuration keeps serving until the new one is ready, and you are billed for both while they overlap.

## Common mistakes

- **Setting `workload_size` and provisioned concurrency together.** They are two ways to say the same thing, and the concurrency parameters should not be used when `workload_size` is set.
- **Sizing from average latency measured on a toy payload.** The formula is only as good as the latency you feed it, and latency grows with payload. Load test at production shape, then size.
- **Leaving scale to zero on in production to save money.** It saves money and spends a 10 to 20 second cold start on a real user, with no SLA behind that number.
- **Planning to enable route optimisation later.** It is creation-time only. Retrofitting it means a new endpoint, a new URL, and a client that has moved from a personal access token to OAuth.
- **Assuming any concurrency value is accepted.** It must be a multiple of 4, and on GPU it also sets the replica count, which is concurrency divided by four.
- **Treating a deployment timeout on GPU as a bug in the model.** A container build over 60 minutes fails the deployment, and a large model can run the disk out, reported as `No space left on device`.

> [!exam]
> Know the three settings by name: `workload_type` for CPU versus GPU hardware, `workload_size` (`Small` 0 to 4, `Medium` 8 to 16, `Large` 16 to 64 concurrent requests) or provisioned concurrency for capacity, and `scale_to_zero_enabled` for idling. Know the sizing rule, concurrency equals QPS multiplied by model run time, and that scale to zero trades a cold start for cost and is not recommended in production. The distinction that catches people out: traffic splitting across served entities decides which model answers, while concurrency decides how many requests can be answered at once.
