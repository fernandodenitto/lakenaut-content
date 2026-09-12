---
id: compute-options
title: "Choosing compute: all-purpose, job cluster, serverless, SQL warehouse"
area: compute
level: beginner
summary: Databricks offers serverless compute, all-purpose clusters, job clusters, and SQL warehouses. Each has its own DBU-based cost model, its own limits, and a use case where it's the right choice.
prerequisites: [platform-architecture]
related: [jobs-overview, cluster-troubleshooting, spark-tuning-basics, unity-catalog-overview]
exams:
  - cert: de-associate
    domain: "Databricks Intelligence Platform"
    objective: "Understand Databricks Data Intelligence Platform's compute services, including their characteristics, limitations, and cost models, and select the most suitable option for each workload use case."
sources:
  - url: https://docs.databricks.com/aws/en/compute/
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/compute/choose-compute
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/compute/configure
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/compute/serverless/limitations
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/compute/sql-warehouse/warehouse-types
    checked: 2026-09-09
aliases: [cluster, all-purpose cluster, job cluster, serverless compute, sql warehouse, dbu]
updated: 2026-09-09
status: published
---

## What it is

**Compute** is the set of resources that runs your code. On Databricks it isn't one single thing: interactive notebooks, scheduled jobs, SQL queries, and pipelines each have their own compute type, with different startup times, costs, and limits. The exam doesn't ask you to configure a cluster in detail, but it does ask you to **pick** the right compute for a given workload.

## Why it exists

An exploratory notebook needs a cluster that stays up and responds instantly; an overnight ETL job needs resources that spin up, do the work, and die; a dashboard needs a SQL engine with high concurrency and low latency. A single compute type would do at least two of these three things badly.

## How it works

### The types

| Type | Who uses it | Where it runs | Startup | Lifespan |
| --- | --- | --- | --- | --- |
| **Serverless compute** (notebooks, jobs, pipelines) | everyone | Databricks account | seconds | for the duration of the workload |
| **All-purpose compute** | interactive notebooks, multiple users | customer's account | minutes | until you shut it down (auto termination) |
| **Job compute** | a single job run | customer's account | minutes | created by the run, destroyed when it finishes |
| **SQL warehouse** serverless / pro / classic | SQL queries, dashboards, alerts, SQL tasks | serverless: Databricks; pro/classic: customer | 2-6 s for serverless, ~4 min for the others | with auto stop |

**Serverless** is the recommended default for notebooks, jobs, and pipelines: nothing to configure, automatic scaling, fast startup. Classic compute remains for whatever serverless doesn't cover.

### Cost model

The unit of measure is the **DBU**, processing capacity per hour. With classic compute you pay DBUs to Databricks **plus** VMs to the cloud provider; DBU rates differ by type: all-purpose costs more per DBU than job compute, which is designed for automated workloads. With serverless, the DBU **includes** the infrastructure: a single price, no separate VM cost. **SQL warehouses** are measured in DBUs per size (2X-Small, Small, …).

Rule of thumb: a scheduled job running on an all-purpose cluster pays the interactive rate for work that isn't interactive.

### Configuring classic compute

- **Policy**: rules written by the workspace admin that limit what a user can create (instance types, max workers, DBU/hour, auto termination). The user picks a policy from a menu; "Unrestricted" is reserved for those with full rights.
- **Access mode**: *Standard* (multiple users, isolated from each other, required by Unity Catalog for shared work) or *Dedicated* (a single user or group).
- **Single node**: a driver with no workers. For non-distributed libraries, small datasets, testing. Doesn't scale.
- **Autoscaling**: a minimum and maximum number of workers; the cluster grows with the load and shrinks when idle.
- **Photon**: a native vectorized engine that speeds up SQL and DataFrame workloads; on by default on recent runtimes, costs more DBUs but finishes sooner.
- **Auto termination**: shuts down an all-purpose cluster after N minutes of inactivity. Always set it.
- **Instance pool**: pre-started VMs on standby, reducing startup time.

### Serverless limits

Serverless is simpler precisely because it removes choices. Things you can't do:

- languages: no R; Scala isn't available in notebooks; Spark Connect API only, no RDDs;
- almost all Spark configurations are locked down; `cache()` / `persist()` / `CACHE TABLE` aren't supported;
- no init scripts, custom containers, policies, instance pools, or Maven coordinates;
- limited DBFS access: external sources go through Unity Catalog instead;
- maximum job duration: 7 days;
- no choice of instance type (so no GPUs).

If your workload needs any of that, you need a job cluster or a classic all-purpose cluster.

### SQL warehouse

Three types. **Serverless**: starts in seconds, Photon, Predictive IO, and Intelligent Workload Management; the default in the UI. **Pro**: Photon and Predictive IO, but starts in minutes and runs in your own account; useful for custom networking or federation to on-premises databases. **Classic**: Photon only, the baseline option.

## Example

A team has to pick compute for four needs:

| Need | Choice | Why |
| --- | --- | --- |
| Explore data in a Python notebook | serverless | instant startup, no management |
| Scheduled PySpark ETL overnight | serverless for the job, job compute if a custom config is needed | never all-purpose in production |
| AI/BI dashboard for 50 analysts | serverless SQL warehouse | concurrency and latency |
| Training with GPU and an R library | dedicated classic all-purpose | serverless has neither GPUs nor R |

Defining it in a bundle (see [[bundles-overview]]) makes the choice explicit per task:

```yaml
tasks:
  - task_key: etl_silver
    notebook_task: { notebook_path: ./etl_silver.py }
    # no compute declared: serverless
  - task_key: report
    sql_task:
      warehouse_id: ${var.warehouse_id}
      file: { path: ./report.sql }
```

## Common mistakes

- Scheduling jobs on an all-purpose cluster "because it's already running": a higher rate and contention with users.
- Leaving an all-purpose cluster without auto termination: you pay for hours of idle time.
- Choosing single node for a dataset of hundreds of GB: the driver runs out of memory (see [[cluster-troubleshooting]]).
- Migrating to serverless without checking the code for RDDs, `cache()`, and Spark configurations.
- Using a SQL warehouse for a PySpark notebook: it only runs SQL.

> [!exam]
> The questions are "pick the tool": scheduled ETL → serverless or job compute, never all-purpose; BI queries with many users → serverless SQL warehouse; non-distributed library or testing → single node; GPU, R, RDDs, or special Spark configs → classic. On cost, remember: DBU + VM in classic, everything included in serverless; all-purpose costs more per DBU than job compute. **Policies** let the admin limit what users can create, **autoscaling** adapts workers to the load, **Photon** speeds up SQL and DataFrame workloads.
