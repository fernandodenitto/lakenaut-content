---
id: jobs-control-flow
title: "Control flow: retries, if/else, for each, run job"
area: jobs-pipelines
subarea: jobs
level: intermediate
summary: "Per-task retries and timeouts, If/else tasks for conditional branches, For each for loops, and Run job for composing jobs: the control logic lives in the graph, not in the code."
prerequisites: [jobs-overview, jobs-task-dependencies]
related: [jobs-parameters, jobs-repair-runs, jobs-triggers, jobs-task-dependencies]
exams:
  - cert: de-associate
    domain: "Working with Lakeflow Jobs"
    objective: "Implement control flows (retries and conditional tasks such as branching and looping) using Lakeflow Jobs for pipeline orchestration"
sources:
  - url: https://docs.databricks.com/aws/en/jobs/conditional-tasks
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/jobs/if-else
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/jobs/for-each
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/jobs/configure-task
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/jobs/run-job
    checked: 2026-09-09
  - url: https://docs.databricks.com/api/workspace/jobs/create
    checked: 2026-09-09
aliases: [if/else task, for each task, run job task, condition task, retry, retries, branching, looping]
updated: 2026-09-09
status: published
---

## What it is

A job's **control flow** is the set of mechanisms that decide **whether**, **how many times**, and **over how many elements** a task runs. Lakeflow Jobs has four of them:

| Mechanism | Question it answers | Where it is configured |
| --- | --- | --- |
| Retries and timeout | "If it fails, do I retry? How long do I wait at most?" | settings of each task |
| If/else | "Do I run this branch or the other one?" | task of type *If/else condition* |
| For each | "Do I repeat the same task for every element of a list?" | task of type *For each* |
| Run job | "Do I launch another job as a step of this one?" | task of type *Run job* |

Dependencies and the `run_if` condition (see [[jobs-task-dependencies]]) are the first level of control; the ones above are layered on top of the DAG.

## Why it exists

Without these tools the control logic ends up inside the notebooks: a `for` over regions, a `try/except` with `sleep` to retry, an `if` that decides whether to launch the aggregation. The run graph shows none of it, you cannot repair a single element of the loop (see [[jobs-repair-runs]]), and you cannot parallelize the iterations. Moving the control into the job makes it visible, repeatable, and parallel.

## How it works

### Retries and timeout

These are **task** settings, not job settings. In the API and in bundles:

| Field | Meaning | Default |
| --- | --- | --- |
| `max_retries` | attempts after the first failure; `-1` = unlimited | `0` |
| `min_retry_interval_millis` | minimum wait between the start of the failed attempt and the next one | `0` (immediately) |
| `retry_on_timeout` | retry also when the task times out | `false` |
| `timeout_seconds` | maximum duration of **each** attempt; `0` = no limit | `0` |

Two details the exam loves: the timeout applies to each retry, not to the total; and there is no job-level retry, except for *continuous* jobs, which use exponential backoff (see [[jobs-triggers]]). Job notifications do not fire on intermediate attempts: for an alert on every failure you need task notifications (see [[jobs-repair-runs]]).

### If/else

The *If/else condition* task evaluates a boolean expression `left op right` and produces the outcome `true` or `false`. Downstream tasks declare which outcome they depend on with `depends_on` and `outcome`.

| Operator (UI) | API value | Comparison |
| --- | --- | --- |
| `==`, `!=` | `EQUAL_TO`, `NOT_EQUAL` | **string**: `12.0 == 12` is false |
| `>`, `>=`, `<`, `<=` | `GREATER_THAN`, `GREATER_THAN_OR_EQUAL`, `LESS_THAN`, `LESS_THAN_OR_EQUAL` | **numeric**: `12.0 >= 12` is true |

The operands can be fixed values, job parameters `{{job.parameters.name}}`, or task values `{{tasks.task_name.values.key}}` written by an upstream task (see [[jobs-parameters]]). Only numbers, strings, and booleans are allowed. The tasks on the branch that was not chosen end in the **Excluded** state: it is not an error, and the run stays green.

### For each

The *For each* task repeats a nested task for every element of `inputs`:

- `inputs`: a hand-written JSON array (strings, numbers, booleans, or objects), or a dynamic reference to a task value or a job parameter;
- `concurrency`: iterations in parallel, from 1 (default) to 100;
- `task`: the nested task, of any type **except** another For each.

Inside the nested task the current element is read with `{{input}}` or, if it is an object, `{{input.field}}`. Every iteration has its own state in the run and can be repaired on its own.

### Run job

The *Run job* task starts another job in the workspace and waits for it to finish. It accepts `job_parameters` to override the child job's defaults, just like "Run now with different parameters". Limits: at most **three levels** of nesting and no circular dependency (A launching B launching A is rejected). It exists to compose reusable jobs.

## Example

A job that counts new rows, proceeds only if there are any, processes three regions in parallel, and finally calls the dashboard refresh job:

```yaml
resources:
  jobs:
    sales_by_region:
      name: sales_by_region
      tasks:
        - task_key: count_new
          notebook_task: { notebook_path: ./notebooks/count_new.py }
          max_retries: 2
          min_retry_interval_millis: 60000
          timeout_seconds: 900
        - task_key: has_rows
          depends_on: [{ task_key: count_new }]
          condition_task:
            op: GREATER_THAN
            left: "{{tasks.count_new.values.new_rows}}"
            right: "0"
        - task_key: per_region
          depends_on: [{ task_key: has_rows, outcome: "true" }]
          for_each_task:
            inputs: '["north", "central", "south"]'
            concurrency: 3
            task:
              task_key: process_region
              notebook_task:
                notebook_path: ./notebooks/process_region.py
                base_parameters: { region: "{{input}}" }
        - task_key: no_data
          depends_on: [{ task_key: has_rows, outcome: "false" }]
          notebook_task: { notebook_path: ./notebooks/log_no_data.py }
        - task_key: refresh_bi
          depends_on: [{ task_key: per_region }]
          run_job_task:
            job_id: ${resources.jobs.refresh_dashboard.id}
            job_parameters: { date: "{{job.start_time.iso_date}}" }
```

The `count_new` notebook publishes the value read by the condition:

```python
rows = spark.sql("SELECT count(*) AS n FROM bronze.sales WHERE ingest_date = current_date()").first()["n"]
dbutils.jobs.taskValues.set(key="new_rows", value=rows)
```

## Common mistakes

- Comparing numbers with `==`: it is a string comparison, so `"12.0"` and `"12"` are different. For numbers use `>=` and `<=`, or normalize the value upstream.
- Publishing a task value that is not a number, a string, or a boolean (a list, for example) and using it in an If/else: the condition task fails.
- Setting `max_retries: -1` on a task that fails because of a bug: the job never ends and burns compute.
- Nesting a For each inside a For each: not allowed; split it into two jobs and use Run job.
- Expecting a child job called via Run job to show up as a task of the parent: it has its own run, the parent only shows the outcome and a link.

> [!exam]
> The exam asks you to pick the right tool: "run the aggregation only if rows arrived" → **If/else** on a task value; "apply the same notebook to a list of countries" → **For each**; "retry a flaky task" → **retries** on the task, with a minimum interval; "reuse an existing job" → **Run job**. Remember the numeric limits: For each concurrency up to 100, Run job nesting up to 3 levels, `max_retries: -1` means unlimited retries, and the timeout applies to each single attempt.
