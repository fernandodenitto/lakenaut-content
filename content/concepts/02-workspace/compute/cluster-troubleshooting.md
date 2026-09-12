---
id: cluster-troubleshooting
title: "Diagnosing clusters: startup failures, libraries, out of memory"
area: compute
subarea: troubleshooting
level: intermediate
summary: The event log and driver logs tell you why a cluster didn't start; precedence rules explain library conflicts; telling driver OOM apart from executor OOM points you to the right fix.
prerequisites: [compute-options, spark-tuning-basics]
related: [compute-options, spark-ui-bottlenecks, runs-monitoring, jobs-repair-runs]
exams:
  - cert: de-associate
    domain: "Troubleshooting, Monitoring, and Optimization"
    objective: "Diagnose cluster startup failures, library conflicts, and out-of-memory issues."
sources:
  - url: https://docs.databricks.com/aws/en/compute/troubleshooting/
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/compute/clusters-manage
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/libraries/
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/libraries/notebooks-python-libraries
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/init-scripts/logs
    checked: 2026-09-09
aliases: [cluster startup failure, library conflict, out of memory, oom, driver oom, event log, init script failure]
updated: 2026-09-09
status: published
---

## What it is

A classic cluster (see [[compute-options]]) can fail at three distinct points: **before it starts** (the cloud can't provision the machines, an init script exits with an error, a policy blocks the configuration), **while loading libraries** (conflicting versions across the runtime, the cluster, and the notebook), and **during execution** (out of memory on the driver or on an executor). Each leaves traces in a different place: the cluster's **event log**, the **driver logs**, and the Spark UI.

## Why it exists

A job that fails with "cluster terminated" or "Python kernel died" tells you nothing useful if all you look at is the run status (see [[runs-monitoring]]). Being able to trace the cause in a few minutes is what separates someone who fixes the problem from someone who just relaunches the job and hopes. Serverless makes a lot of these problems go away, but job clusters and all-purpose clusters are still the norm on many teams.

## How it works

### Where to look

| Source | What it contains | When you need it |
| --- | --- | --- |
| **Event log** (cluster tab, 60 days) | lifecycle events: `CREATING`, `STARTING`, `INIT_SCRIPTS_STARTED/FINISHED`, `RUNNING`, `RESIZING`, `DRIVER_NOT_RESPONDING`, `TERMINATING` with a reason | failed startups, unexpected terminations |
| **Driver logs** (stdout, stderr, log4j) | Python/Scala exceptions, `print` output, `pip` errors | code, libraries, driver OOM |
| **Spark UI → Executors / Stages** | memory per executor, failed tasks, spill | executor OOM, skew (see [[spark-ui-bottlenecks]]) |
| **Init script logs** | per-node stdout/stderr under `<log-path>/<cluster-id>/init_scripts/` if you enabled log delivery | a failing init script |

### Failed startup

The `TERMINATING` event in the event log carries the **termination reason**. Common causes:

| Reason | Symptom | Fix |
| --- | --- | --- |
| Cloud quota exhausted | *cloud provider launch failure*, vCPU or instance limit reached | request a quota increase, use pools or different instance types |
| Instance type unavailable | insufficient capacity in the zone, spot instances not granted | change instance type, fall back to on-demand, try another zone |
| Policy | the UI refuses to save or start: a value outside the cluster policy's limits | read the policy, adjust the configuration, or request a different policy |
| Init script | `INIT_SCRIPTS_STARTED` event with no `FINISHED`, then termination with *init script failure* | read the script's stderr; test on a small cluster; keep scripts in a Unity Catalog volume, not DBFS |
| Network | *self-bootstrap failure*, unresponsive driver | VPC, security group, Databricks service endpoints |

### Library conflicts

Libraries come from different levels, and when two levels bring different versions of the same package, the level with higher precedence wins:

1. current directory and the root of a Git folder;
2. **notebook-scoped**: `%pip install` in the session;
3. **cluster-scoped**: installed from the UI, the API, or a bundle, from PyPI, Maven, CRAN, volumes, or workspace files;
4. packages bundled with the **Databricks Runtime**;
5. workspace files added to `sys.path`.

Practical rules:

- `%pip install` belongs in the **first cell**: it reinstalls on every session, isn't persistent, and doesn't touch other notebooks. After an install that changes an already-imported package, you need `dbutils.library.restartPython()`.
- A "core" package (pandas, numpy, IPython) bumped past the runtime's version can break `display`, `toPandas`, or the kernel; the fix is to go back to the runtime's version, or switch runtimes.
- If a cluster-scoped library fails to install, the cluster still starts, but the *Libraries* tab shows *Failed*: notebooks that import it fail with `ModuleNotFoundError`.
- In production: declare cluster-scoped libraries (or an `environment` for serverless) in the bundle, keep wheels in a Unity Catalog volume, and pin versions.

### Out of memory

The first step is figuring out **who** ran out of memory.

| | Driver | Executor |
| --- | --- | --- |
| How it shows up | *Driver is not responding*, dead Python kernel, `OutOfMemoryError` in the driver logs, notebook detached | tasks failing and getting retried, `ExecutorLostFailure`, massive spill, container killed by the system |
| Typical causes | `collect()`, `toPandas()`, `display` on huge results, broadcasting a table that's too big, too many notebooks attached to the same cluster | skew (one huge partition), caching DataFrames that don't fit, UDFs accumulating state, very wide rows |
| Fixes | don't pull data onto the driver: write to a table, `limit`, aggregate first; drop the broadcast (`spark.sql.autoBroadcastJoinThreshold`); a bigger driver; separate interactive workloads | shrink partition size (`repartition`, more shuffle partitions), fix the skew, instances with more memory per core, less `cache` |

A driver OOM kills the entire cluster; an executor OOM only loses its own tasks, which Spark retries until it eventually fails the stage.

## Example

Guided diagnosis of an overnight job that failed with "Cluster terminated":

```bash
# 1. cluster event log for the run's cluster, from the CLI
databricks clusters events 0909-060012-abc123 --output json | head -60
# look for the last TERMINATING event and its "reason" field
```

If the reason is `INIT_SCRIPT_FAILURE`, open the script's stderr at the log delivery path — usually the culprit is an `apt-get` that can't resolve or a `pip` with no network access. If instead the cluster started fine and the driver died:

```python
# anti-pattern that drowns the driver
pdf = spark.table("silver.events").toPandas()          # 400 million rows onto the driver

# version that stays distributed
(spark.table("silver.events")
   .groupBy("day").agg(F.count("*").alias("n"))
   .write.mode("overwrite").saveAsTable("gold.events_by_day"))
```

```sql
-- spot an oversized broadcast from the plan
EXPLAIN FORMATTED
SELECT /*+ BROADCAST(c) */ * FROM silver.events e JOIN silver.customers c USING (customer_id);
-- a "BroadcastExchange" on a table of tens of GB: remove the hint
```

## Common mistakes

- Relaunching the job without checking the event log: if the cause is quota or capacity, the retry fails the same way and burns through the overnight window.
- Fixing a driver OOM with bigger workers: the driver is a single node; what you need is less data on the driver, or a bigger driver.
- Installing libraries with `%pip` partway through a notebook, after the imports: the new version only loads after a restart, and the two halves of the notebook end up seeing different versions.
- Using a shared all-purpose cluster for heavy jobs: user notebooks and the job compete for driver memory, and failures start to look random.
- Init scripts that download from the internet on every startup: they fail at the first network hiccup. Better to keep wheels and artifacts in a volume.

> [!exam]
> Three scenarios, three answers. *The cluster won't start*: event log, termination reason (quota, unavailable instance type, init script, policy). *`ImportError` or the wrong version*: precedence is notebook-scoped > cluster-scoped > runtime; put `%pip` at the top and restart Python. *Driver unresponsive after `collect()` or `toPandas()`*: driver OOM, keep the work distributed or size up the driver; if tasks are failing instead, it's executor OOM, so look at skew and partition size.
