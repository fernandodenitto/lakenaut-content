---
id: instance-pools
title: "Instance pools and autoscaling"
area: compute
level: intermediate
summary: A pool keeps idle VMs on standby so clusters attach to them instead of waiting on the cloud provider, and autoscaling adjusts worker count once a cluster is up.
prerequisites: [compute-options, cluster-policies]
related: [runtime-and-photon, cluster-troubleshooting, pipelines-overview, serverless-compute]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/compute/pool-index
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/compute/configure
    checked: 2026-09-10
aliases: [instance pool, warm pool, idle instances, min idle instances, spot instances, enhanced autoscaling]
updated: 2026-09-11
status: published
---

## What it is

An **instance pool** is a set of VMs Databricks keeps idle and ready, sitting between "not provisioned" and "attached to a cluster." When a cluster is created against a pool, its driver and workers claim nodes straight from that idle set instead of asking the cloud provider for fresh capacity; if the pool runs dry, it falls back to provisioning normally. **Autoscaling** is a separate, later concern — once a cluster exists, it grows and shrinks worker count within a min/max range, whether or not those workers come from a pool.

## Why it exists

Provisioning a VM from a cloud provider is the slowest part of starting a classic cluster — often minutes, dominated by the provider's own boot and networking setup. That's trivial for an all-purpose cluster started once a day, but it adds up fast for **job clusters**, created and destroyed on every run: a pipeline with fifty short runs a day pays the provisioning tax fifty times. A pool amortizes it by keeping VMs already booted, so a new cluster only has to attach the runtime, not wait on the cloud API.

## How it works

### Sizing a pool

- **Min idle instances**: the floor of always-idle VMs the pool maintains; Databricks replaces any claimed by a cluster. This is the number that actually costs money — the cloud provider bills for these VMs even idle, though Databricks doesn't charge DBUs for idle time.
- **Max capacity**: a ceiling on idle plus in-use instances combined; a cluster asking for more fails outright rather than silently over-provisioning.
- **Idle instance auto-termination**: minutes above the min-idle floor a returned, no-longer-needed instance may sit before it's terminated — the buffer between "just finished" and "shrink back to the floor."
- **Preloaded Databricks Runtime**: baking a runtime image (see [[runtime-and-photon]]) onto idle instances shaves more time off attach; unset, the runtime downloads when a cluster claims the node.

The instance type is fixed at pool creation — a new hardware need means a new pool, not an edit.

### Autoscaling on a cluster

A cluster (job or all-purpose) takes a **min** and **max** worker count instead of a fixed size; Databricks adds or removes workers inside that range as the workload's shape changes, with nothing resized by hand. It's the mechanism that adapts to load; the pool is what makes each addition fast.

### Enhanced autoscaling for pipelines

Standard autoscaling scales down poorly for Structured Streaming, since Spark won't remove a worker holding shuffle state it can't confirm is safe to drop. [[pipelines-overview|Lakeflow pipelines]] default to **enhanced autoscaling** instead, which understands the pipeline's streaming and batch flows well enough to scale down safely, not just up — set via `mode: ENHANCED`, with a **Max workers** ceiling that's still the cost/latency dial you tune.

### Spot instances

A pool is one instance type at one pricing model — all spot or all on-demand, not a mix — with a maximum spot price as a percentage of on-demand. At the cluster level, spot is more conservative: the driver is always on-demand, only workers are requested as spot, and Databricks falls back to on-demand for any worker that can't get spot pricing.

### When a pool isn't worth it

If a workload can run on [[serverless-compute]], that's the better answer: capacity is already warm on Databricks' side, with no pool to size, no min-idle cost to carry, no instance type fixed in advance. Pools still earn their place for classic job clusters with frequent short runs, or a workload needing an instance family or GPU serverless doesn't offer.

## Example

A pool sized for frequent short job runs, referenced from a bundle:

```json
{
  "instance_pool_name": "job-pool-i3-2xlarge",
  "node_type_id": "i3.2xlarge",
  "min_idle_instances": 2,
  "max_capacity": 30,
  "idle_instance_autotermination_minutes": 15,
  "preloaded_spark_versions": ["16.4.x-scala2.12"]
}
```

```yaml
resources:
  jobs:
    frequent_ingest:
      job_clusters:
        - job_cluster_key: main
          new_cluster:
            instance_pool_id: "${var.job_pool_id}"
            autoscale:
              min_workers: 2
              max_workers: 8
```

## Common mistakes

- Setting `min_idle_instances` high "to be safe" on a pool that feeds a handful of runs a day — full-time cloud VM cost for capacity that sits unused.
- Expecting a pool to cut library or environment setup time — it only removes VM boot latency, not anything after the node attaches.
- Trying to mix spot and on-demand nodes in one pool — split the workload across two pools if you need both.
- Leaving standard autoscaling on a heavy streaming pipeline, then wondering why the cluster never scales back down.
- Building a pool for a workload that would run fine on serverless — solving a start-time problem serverless doesn't have.

> [!tip]
> Before sizing a pool, ask whether the workload could run serverless instead — usually less to operate for the same or better start time. Pools earn their keep on high-frequency classic job clusters and hardware serverless doesn't offer.
