---
id: jobs-serverless
title: Serverless compute for jobs
area: jobs-pipelines
subarea: jobs
level: intermediate
summary: Serverless is the default compute for most Lakeflow Jobs tasks. Which task types take it, how environments and performance modes are declared, and when a job cluster still wins.
prerequisites: [jobs-overview, serverless-compute]
related: [serverless-compute, compute-options, jobs-overview, bundles-overview, streaming-triggers]
exams:
  - cert: de-associate
    domain: "Databricks Intelligence Platform"
    objective: "Understand the compute services available for jobs, their limitations and cost model, and select the most suitable option for each workload."
sources:
  - url: https://docs.databricks.com/aws/en/jobs/run-serverless-jobs
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/jobs/compute
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/compute/serverless/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/compute/serverless/limitations
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/compute/serverless/best-practices
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/compute/serverless/dependencies
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/dev-tools/bundles/examples
    checked: 2026-09-11
aliases: [serverless jobs, serverless compute for workflows, environment_key, performance optimized, standard performance mode, jobs environment]
updated: 2026-09-11
status: published
maturity: ga
---

## What it is

Serverless compute for workflows is what runs a Lakeflow Jobs task when the task has no cluster attached. Databricks picks the instance types, the memory and the engine, turns autoscaling and Photon on for you, and keeps optimising the shape of the compute while the workload runs. It is the default compute type for every task that supports it.

Two consequences show up immediately: cluster creation permission is not needed, so any workspace user can run a job, and there is no Databricks Runtime version in the task definition, because serverless is versionless.

This page covers the job-shaped parts. The platform mechanics live in [[serverless-compute]], and the comparison against the other compute types in [[compute-options]].

## Why it exists

A job cluster is billed to a team that never wanted to own it. Every run pays a provisioning tax of several minutes while VMs are requested and the driver and executors find each other; somebody has to keep `spark_version` current across dozens of job definitions; and only users with cluster creation rights, or a [[cluster-policies|policy]] written for them, can ship a job at all.

Serverless moves all three to Databricks. Capacity is pre-warmed, the runtime is upgraded underneath you on a schedule that keeps your job working, and the compute question disappears from the task definition. What you give up is instance-level control, and that trade is only wrong for a specific and shrinking list of workloads.

## How it works

### Which task types take it

| Task type | Compute |
| --- | --- |
| Notebook, Python script (`spark_python_task`), Python wheel | serverless (recommended), classic jobs, classic all-purpose |
| dbt | serverless, or a SQL warehouse for the SQL side |
| JAR | serverless or classic jobs |
| Spark Submit | classic jobs only |

SQL tasks run on a serverless or pro SQL warehouse, never on a cluster, and a pipeline task takes its compute from the pipeline. Compute is a per-task property, so one job can mix a serverless notebook task with a Spark Submit task on a job cluster. See [[jobs-task-dependencies]].

### The Unity Catalog requirement

The workspace has to be enabled for [[unity-catalog-overview|Unity Catalog]], and serverless runs in **standard access mode**, so the workload has to be compatible with it. A legacy workspace on the Hive metastore has no serverless path until it is upgraded.

### Automatic runtime upgrades

There is no runtime number to bump. Databricks upgrades the serverless runtime to pick up platform improvements while keeping your jobs stable, and a task pins an **environment version** instead, which fixes the Python version and the pre-installed libraries. Each environment version is supported for three years, so upgrades are planned rather than forced. The flip side is that you cannot hold a job on last year's runtime because a library is fussy: pinning happens at the environment version and the dependency list, not at the runtime.

### Performance modes

| Mode | Startup | Cost | Available for |
| --- | --- | --- | --- |
| Performance optimized (default) | fast, from a warm pool | higher DBU consumption | jobs, pipelines, notebooks |
| Standard | 4 to 6 minutes, depending on availability and scheduling | up to 70% cheaper than performance optimized | jobs and pipelines, not notebooks |

Both use the same SKU; standard just consumes fewer DBUs. In the job details page this is the **Performance optimized** toggle, and it affects only the serverless tasks in the job, which need at least one to exist before the setting appears. For a nightly job where nobody is waiting, standard mode is close to free money.

### Dependencies and environments

Libraries are declared per task, not per cluster, because there is no cluster to install them on. A task environment is a **base environment** (*Standard*, *ML*, a workspace environment configured by an admin, or a custom YAML spec) plus a dependency list in `requirements.txt` format, resolved from public repositories, workspace files under `/Workspace/`, or Unity Catalog volumes under `/Volumes/`. How you declare it depends on the task type:

- **notebook tasks** default to the notebook's own environment, and can be overridden with a job-level environment;
- **Python script, Python wheel and dbt tasks** require one, referenced by `environment_key` in the job definition;
- task libraries are not supported for notebook tasks on serverless: use notebook-scoped libraries instead.

Environments are cached, so two tasks in the same run that share a dependency set install it once. If you change the implementation of an internal package, bump its version number, otherwise the cache hands the job the old code.

### What you give up

| Capability | On a job cluster | On serverless |
| --- | --- | --- |
| Spark Submit tasks | supported | not supported |
| Init scripts, custom containers, Maven coordinates | supported | not supported |
| Compute policies, instance pools, compute event logs | supported | not supported |
| Instance type and GPU choice | yours | Databricks decides |
| Spark UI and Spark logs | full | query profile and client-side logs only |
| `cache()`, `persist()`, `CACHE TABLE` | supported | raise an exception |
| RDD API | supported | Spark Connect only |
| Streaming triggers | all | `Trigger.AvailableNow()` only |
| Maximum run duration | none | 7 days, terminated and **not retried** |
| Per-task log isolation | yes | logs contain output from several tasks |

Most Spark configurations are locked down too, and the allowed ones are session level only, set from a notebook inside the same job.

### Retries you did not ask for

Serverless auto-optimization is on by default and retries failed tasks on top of your own retry policy, so a critical workload runs at least once. For a task that is not idempotent that is the wrong behaviour: uncheck **Enable serverless auto-optimization** in the Retry Policy dialog. See [[jobs-repair-runs]].

### How the cost shows up

There is no VM line on the cloud bill: the serverless DBU rate already includes the infrastructure. Attribution works differently too. With no cluster there are no cluster tags, so an admin defines **serverless usage policies** (in Public Preview as of September 2026) that stamp custom tags on the usage of the users and groups assigned to them, and existing jobs are not retagged automatically. Actual spend comes from the `system.billing.usage` system table, with up to a 24-hour delay after the run.

### When a job cluster is still the right answer

Take the job cluster when the job needs a Spark Submit task, a GPU, R or Scala in a notebook, an init script or a custom container, an instance pool for startup time, RDDs or `cache()`, a Spark configuration outside the allowlist, a run longer than seven days, or a streaming task on `processingTime` or in real-time mode (see [[streaming-triggers]]). That is a real list, not a formality. Everything else belongs on serverless.

## Example: a mixed job in a bundle

```yaml
resources:
  jobs:
    nightly_etl:
      name: nightly_etl
      tasks:
        - task_key: bronze
          notebook_task:
            notebook_path: ../src/bronze.py
          # no compute block and no environment_key: serverless, notebook environment

        - task_key: silver
          depends_on: [{ task_key: bronze }]
          spark_python_task:
            python_file: ../src/silver.py
          environment_key: default          # required for a Python script task

        - task_key: legacy_export
          depends_on: [{ task_key: silver }]
          spark_submit_task:
            parameters: ["--class", "com.shop.Export", "/Volumes/shop/jars/export.jar"]
          new_cluster:                      # Spark Submit cannot run on serverless
            spark_version: "16.4.x-scala2.12"
            node_type_id: i3.xlarge
            num_workers: 2

      environments:
        - environment_key: default
          spec:
            environment_version: "2"
            dependencies:
              - great-expectations==0.18.22
              - /Volumes/shop/utils/wheels/shop_helpers-1.4.0-py3-none-any.whl
```

Two of the three tasks never mention compute. The third does, and the reason is written on it: `spark_submit_task`. The performance mode is not in this file, it is the **Performance optimized** toggle in the job details page, and for a nightly job it should be off. See [[bundles-overview]].

## Common mistakes

- **Assuming a long backfill will finish.** Serverless stops a run at seven days and does not retry it. Split the work or move it to classic compute.
- **Leaving Performance optimized on for overnight jobs.** Standard mode costs up to 70% less and the only price is 4 to 6 minutes of startup that nobody is awake to notice.
- **Porting a streaming task without touching the trigger.** Only `Trigger.AvailableNow()` works; the default trigger and `processingTime` fail with `INFINITE_STREAMING_TRIGGER_NOT_SUPPORTED`.
- **Expecting cluster tags in billing.** There is no cluster. Assign a serverless usage policy, which does not retag existing jobs.
- **Shipping a task that must run at most once with auto-optimization left on.** It adds retries on top of your retry policy.
- **Changing an internal wheel without bumping its version.** The cached environment keeps serving the old build.

> [!exam]
> The pick-the-tool question is the same one as in [[compute-options]], narrowed to a task: notebook, Python script, Python wheel and dbt tasks default to serverless; Spark Submit needs classic job compute; SQL tasks need a SQL warehouse. Know that serverless requires Unity Catalog and runs in standard access mode, that it has no Databricks Runtime version because it is versionless, that dependencies are declared per task through an environment rather than on a cluster, and that the DBU rate includes the infrastructure so there is no separate VM charge.
