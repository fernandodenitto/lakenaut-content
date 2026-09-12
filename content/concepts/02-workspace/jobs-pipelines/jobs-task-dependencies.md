---
id: jobs-task-dependencies
title: Tasks, dependencies, and the job graph
area: jobs-pipelines
subarea: jobs
level: intermediate
summary: The tasks of a job form a DAG. Dependencies set the order; the run-if condition decides whether a task starts based on the outcome of the tasks upstream.
prerequisites: [jobs-overview]
related: [jobs-control-flow, jobs-repair-runs, jobs-parameters, runs-monitoring]
exams:
  - cert: de-associate
    domain: "Working with Lakeflow Jobs"
    objective: "Configure common tasks (notebook, SQL query, dashboard, and pipeline tasks) and their dependencies using Lakeflow Jobs and its DAG-based task graph"
  - cert: de-associate
    domain: "Troubleshooting, Monitoring, and Optimization"
    objective: "Use the Lakeflow Jobs UI to monitor pipeline health by interpreting job statuses, viewing DAG-based task graphs to spot upstream blockers, and tracking pipeline run times and failure rates"
sources:
  - url: https://docs.databricks.com/aws/en/jobs/configure-task
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/jobs/run-if
    checked: 2026-09-09
aliases: [job dependencies, task graph, depends_on, run if]
updated: 2026-09-09
status: published
---

## What it is

**Dependencies** tell a job in which order to run its tasks. The set of tasks and dependencies is a **DAG** (directed acyclic graph): a task starts only when every task it depends on has finished, and tasks with no dependency between them run in parallel.

## Why it exists

A real ETL is not a sequence. Orders and customers can be ingested in parallel, the join has to wait for both, the dashboard has to wait for the join. Describing this as a graph buys you two things: automatic parallelism wherever possible and, when something fails, the ability to restart from the right point (see [[jobs-repair-runs]]).

## How it works

### Declaring dependencies

In the UI you pick "Depends on" inside the task. In the API and in bundles you use `depends_on` with the list of upstream `task_key`s:

```yaml
tasks:
  - task_key: ingest_orders
    notebook_task: { notebook_path: ./ingest_orders.py }
  - task_key: ingest_customers
    notebook_task: { notebook_path: ./ingest_customers.py }
  - task_key: join
    depends_on:
      - { task_key: ingest_orders }
      - { task_key: ingest_customers }
    notebook_task: { notebook_path: ./join.py }
```

`ingest_orders` and `ingest_customers` do not depend on each other: they run together. `join` starts once both have finished.

### The run-if condition

By default a task starts only if **all** upstream tasks succeeded. You can change that rule with `run_if`:

| `run_if` | The task starts if… |
| --- | --- |
| `ALL_SUCCESS` (default) | all upstream tasks succeeded |
| `AT_LEAST_ONE_SUCCESS` | at least one succeeded |
| `NONE_FAILED` | none failed (success or skipped are both fine) |
| `ALL_DONE` | all have finished, whatever the outcome |
| `AT_LEAST_ONE_FAILED` | at least one failed |
| `ALL_FAILED` | all failed |

`ALL_DONE` is the usual choice for a cleanup or notification task that must always run. `AT_LEAST_ONE_FAILED` is for a task that handles the error (for example, writing to an audit table).

```yaml
  - task_key: notify_outcome
    depends_on: [{ task_key: join }]
    run_if: ALL_DONE
    notebook_task: { notebook_path: ./notify.py }
```

### Task states

Every task in a run ends in a state: `SUCCESS`, `FAILED`, `SKIPPED` (dependencies not satisfied), `CANCELED`, `TIMED_OUT`, plus `UPSTREAM_FAILED` / `UPSTREAM_CANCELED` when an upstream task is what blocked it. In the run's graph view these states are color-coded: the fastest way to see **where** a job broke is to read the graph, not the logs.

> [!tip]
> The **job** state is derived from the task states. If a task fails but a downstream task with `run_if: ALL_DONE` succeeds, the job run is still **failed**: `run_if` changes whether the task starts, not the overall outcome.

### Tasks and compute

Different tasks can use different compute: a notebook on serverless, a SQL task on a warehouse, a pipeline on its own compute. Dependencies work the same way. With classic job clusters, tasks that share the same `job_cluster_key` reuse the cluster within the run.

## Example

A diamond-shaped graph with error handling:

```text
ingest_orders ───┐
                 ├─► join ─► aggregate ─► refresh_dashboard
ingest_customers ┘             │
                               └─► audit_errors  (run_if: AT_LEAST_ONE_FAILED)
```

If `aggregate` fails, `refresh_dashboard` becomes `UPSTREAM_FAILED` and `audit_errors` starts. After the fix, a repair run reruns only `aggregate` and `refresh_dashboard`.

## Common mistakes

- Building a linear chain `a → b → c → d` when `b` and `c` are independent: you lose parallelism and the run takes longer.
- Using `ALL_DONE` on a task that writes "final" data: it will run even when the upstream data is incomplete.
- Expecting a dependency to pass data: dependencies only govern order. To pass values between tasks you use **task values** (see [[jobs-parameters]]).
- Forgetting that a `SKIPPED` task is not an error: with the default `ALL_SUCCESS` the downstream tasks do not start, but the run can still end up as "success with skips".

> [!exam]
> Typical questions: "which task starts if the upstream task fails?" (answer: only those with a suitable `run_if`, the others end up upstream failed); "how do you run two tasks in parallel?" (no dependency between them); "how do you run a cleanup task regardless of the outcome?" (`ALL_DONE`). The exam uses the `run_if` value names as they appear in the UI: *All succeeded*, *At least one succeeded*, *None failed*, *All done*, *At least one failed*, *All failed*.
