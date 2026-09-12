---
id: serverless-compute
title: "Serverless compute"
area: compute
level: intermediate
summary: Serverless compute runs notebooks, jobs, and pipelines on Databricks-managed infrastructure with no cluster to configure, at the cost of some Spark control.
prerequisites: [compute-options, runtime-and-photon]
related: [cluster-policies, instance-pools, jobs-overview, pipelines-overview]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/compute/serverless/
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/compute/serverless/dependencies
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/compute/serverless/limitations
    checked: 2026-09-10
aliases: [serverless, serverless notebooks, serverless jobs, serverless pipelines, environment version, base environment]
updated: 2026-09-11
status: published
---

## What it is

Serverless compute is Databricks running your notebook, job, or pipeline on infrastructure it owns, in its own account rather than yours. No cluster to size, no instance type to pick, no autotermination timer: you submit code, capacity attaches in seconds, and it disappears when the run ends. It covers notebooks, job tasks, and Lakeflow pipelines — compute stops being something you administer.

## Why it exists

Classic compute (see [[compute-options]]) carries a provisioning tax: even a "fast" job cluster needs minutes to request VMs from the cloud provider and join the driver and executors before your code runs, a tax paid on every run for workloads that rarely need instance-level control. Serverless removes it by keeping capacity warm on Databricks' side and multiplexing it across customers — speed and zero operational surface, in exchange for direct control over the machine.

## How it works

### What you give up

Serverless is simpler because it removes decisions, not because it's a shrunk version of classic compute:

| Capability | Classic compute | Serverless |
| --- | --- | --- |
| Spark UI | full | not available — use the query profile instead |
| Spark configuration | mostly open | a short allowlist only |
| Init scripts / containers | supported | not supported |
| Instance type / GPU choice | yours to pick | none — Databricks picks |
| Languages in notebooks | Python, SQL, Scala, R | Python and SQL only |
| `cache()` / `persist()` / `CACHE TABLE` | supported | raise an exception |
| RDD API | supported | Spark Connect only, no RDDs |
| Max run duration | none | 7 days |

If a workload depends on any row in the right column, it belongs on a job cluster or an all-purpose cluster, not on serverless.

### Environment versions and the base environment

A serverless notebook or job skips the Databricks Runtime version and instead picks an **environment version**, fixing the Python version and pre-installed packages, patched by Databricks with no runtime number to bump. Each environment starts from a **base environment**: *Standard* (default), *ML* (the ML/DL libraries classic ML runtimes bundled), *AI* (GPU-oriented), or a *Custom* one defined with a YAML spec — exportable from a notebook so a job reuses the exact same environment.

### Adding libraries

Dependencies go per notebook or per job, not per cluster: a requirements.txt-style list, a wheel, or a project with `pyproject.toml`, sourced from workspace files or Unity Catalog volumes. Two gotchas classic compute doesn't have: never install PySpark itself, or anything pulling it in — it kills the session — and since serverless can land on either `aarch64` or `x86_64`, a native wheel needs both architectures or a marker restricting it.

### Budget policies, tagging, and cost

Serverless usage isn't tagged by cluster custom tags, because there's no cluster — an admin instead creates a **budget policy** (a name plus tags) and assigns users, groups, or service principals to it, so every serverless run they trigger is stamped in billing automatically. It's the serverless equivalent of `custom_tags` in a [[cluster-policies|cluster policy]].

Serverless bills per second at its own DBU rate, with no separate VM charge — the rate already bakes in the infrastructure cost. Startup is fast, often single-digit seconds, thanks to pre-warmed capacity behind the scenes, but it isn't instantaneous: the first request in a while can still lag a warm one, so "serverless" doesn't mean zero cold start.

## Example

A job mixing a serverless task with a legacy one that still needs a classic cluster, plus the environment spec the serverless task depends on:

```yaml
resources:
  jobs:
    nightly_etl:
      tasks:
        - task_key: bronze_to_silver
          notebook_task: { notebook_path: ./silver.py }
          # no compute block: runs on serverless
        - task_key: legacy_rdd_job
          notebook_task: { notebook_path: ./legacy.py }
          job_cluster_key: classic_pool
      job_clusters:
        - job_cluster_key: classic_pool
          new_cluster: { spark_version: "16.4.x-scala2.12", num_workers: 4 }
```

```yaml
# environment.yml exported from the serverless notebook, reused by the job
client: ">=1"
dependencies:
  - my_internal_pkg==2.3.1
  - /Volumes/main/utils/wheels/geo_helpers-0.4.0-py3-none-any.whl
```

## Common mistakes

- Migrating to serverless without checking for `cache()`, RDDs, or a blocked Spark config — it only fails at run time.
- Installing a native-extension wheel built for one CPU architecture, then hitting random `ImportError`s depending on the node.
- Expecting billing tags from a cluster configuration — on serverless they come from the assigned budget policy instead.
- Reaching for serverless for a GPU training job or an R notebook — neither is on the table.

> [!tip]
> Default to serverless for notebooks, jobs, and pipelines unless you hit a row in the limitations table above — that's the signal to fall back to a job cluster with an explicit [[cluster-policies|policy]], not a reason to avoid serverless everywhere.
