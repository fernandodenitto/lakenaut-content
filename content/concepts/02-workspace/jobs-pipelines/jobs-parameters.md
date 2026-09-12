---
id: jobs-parameters
title: Job and task parameters, dynamic values, and task values
area: jobs-pipelines
subarea: jobs
level: intermediate
summary: Job parameters apply to every task, task parameters to just one; dynamic values like {{job.start_time.iso_date}} carry context; task values pass results from one task to another.
prerequisites: [jobs-overview, jobs-task-dependencies]
related: [jobs-control-flow, jobs-triggers, jobs-repair-runs, bundles-variables-targets]
exams:
  - cert: de-associate
    domain: "Working with Lakeflow Jobs"
    objective: "Configure common tasks (notebook, SQL query, dashboard, and pipeline tasks) and their dependencies using Lakeflow Jobs and its DAG-based task graph"
sources:
  - url: https://docs.databricks.com/aws/en/jobs/job-parameters
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/jobs/parameter-use
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/jobs/dynamic-value-references
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/jobs/task-values
    checked: 2026-09-09
aliases: [job parameters, task parameters, dynamic value references, task values, widgets, dbutils.jobs.taskValues]
updated: 2026-09-09
status: published
---

## What it is

A parameterized job is a job that receives **values from the outside** instead of hard-coding them in the code: the date to process, the target catalog, a check's threshold. Lakeflow Jobs gives you three tools, and the exam likes to mix them up:

| Tool | Who defines it | Who reads it | Example |
| --- | --- | --- | --- |
| Job parameter | the job, with a default | every task | `start_date = 2026-09-01` |
| Task parameter | a single task | only that task | `region = north` |
| Dynamic value reference | the platform, at runtime | any configuration field | `{{job.run_id}}` |
| Task value | a task, in code | downstream tasks | `new_rows = 1200` |

## Why it exists

A notebook with `date = "2026-09-01"` hard-coded needs editing on every run. With parameters the same job serves the nightly load (`start_date` = yesterday), a backfill (`start_date` = a month ago), and a test run (`catalog` = `dev`), without touching the code. Dynamic values save you from computing by hand things the job already knows, like the run date; task values are the only clean way to make two tasks talk to each other, because dependencies only govern order (see [[jobs-task-dependencies]]).

## How it works

### Job parameters and task parameters

**Job parameters** are `name`/`default` pairs; the name accepts letters, digits, `_`, `-`, `.`. The value is a string, which can contain a dynamic value or a JSON payload. They are passed automatically to **every** task that accepts named parameters. **Task parameters** depend on the task type: `base_parameters` for a notebook, `parameters` for a Python script or a SQL task, `named_parameters` for a wheel. If a job parameter and a task parameter share the same key, **the job parameter wins**. Tasks that receive parameters as a positional list (Python script, JAR) don't get job parameters automatically: you have to pass them explicitly with `{{job.parameters.name}}`.

How the code reads them:

| Task type | Reading |
| --- | --- |
| Notebook | `dbutils.widgets.get("name")`; the widget is created by the job |
| SQL (query, file) | a named parameter marker `:name` in the query |
| Python script | `sys.argv` or `argparse` |
| Python wheel | named arguments (`--name value`) via `argparse` |
| JAR / Spark submit | `main` arguments |
| Pipeline | the pipeline's named parameters |

### Dynamic value references

These are `{{…}}` placeholders resolved by the platform **in configuration fields** (parameters, paths, If/else operands), not in the notebook's code. The most common ones:

- `{{job.id}}`, `{{job.name}}`, `{{job.run_id}}`, `{{job.repair_count}}`;
- `{{job.start_time.iso_date}}`, `.iso_datetime`, `.year`, `.month`, `.day`, `.hour`, `.timestamp_ms`, `.iso_weekday`;
- `{{job.parameters.name}}`: the value of a job parameter;
- `{{job.trigger.type}}` and trigger data, like `{{job.trigger.file_arrival.location}}` or `{{job.trigger.table_update.updated_tables}}` (see [[jobs-triggers]]);
- `{{task.name}}`, `{{task.run_id}}`, `{{task.execution_count}}`;
- `{{tasks.task_name.values.key}}`, `{{tasks.task_name.result_state}}`, `{{tasks.task_name.output.first_row.column}}` for a SQL task's output;
- `{{input}}` and `{{input.field}}` inside a For each (see [[jobs-control-flow]]);
- `{{workspace.id}}`, `{{workspace.url}}`.

The legacy forms `{{job_id}}`, `{{run_id}}`, `{{start_date}}`, `{{task_key}}` are deprecated and replaced by the dotted versions.

### Task values

A task publishes a value with `dbutils.jobs.taskValues.set(key, value)`; a downstream task reads it with `dbutils.jobs.taskValues.get(taskKey, key, default=None, debugValue=None)` or, preferably, with the reference `{{tasks.task_name.values.key}}` in a parameter or an If/else condition. The value must be **JSON**-serializable, at most **48 KiB**. `debugValue` is needed when the notebook runs interactively, outside a job: without it, `get` fails. Published values show up in the task run's *Output* panel.

### Changing values on the fly

"Run now with different parameters" lets you override job parameters for a single run without modifying the job; the same applies to the repair dialog (see [[jobs-repair-runs]]). In a bundle, per-environment values are passed through target variables (see [[bundles-variables-targets]]).

## Example

A job with a `start_date` parameter that defaults to the run's date, read by both a SQL task and a notebook, plus a task value that drives an If/else:

```yaml
resources:
  jobs:
    load_orders:
      name: load_orders
      parameters:
        - name: start_date
          default: "{{job.start_time.iso_date}}"
        - name: catalog
          default: main
      tasks:
        - task_key: count_orders
          notebook_task: { notebook_path: ./notebooks/count_orders.py }
        - task_key: has_orders
          depends_on: [{ task_key: count_orders }]
          condition_task:
            op: GREATER_THAN
            left: "{{tasks.count_orders.values.order_count}}"
            right: "0"
        - task_key: load
          depends_on: [{ task_key: has_orders, outcome: "true" }]
          sql_task:
            warehouse_id: ${var.warehouse_id}
            file: { path: ./sql/load_orders.sql }
            parameters:
              run_id: "{{job.run_id}}"   # task parameter, added on top of the job parameters
```

The `count_orders` task publishes the value:

```python
n = spark.sql(
    f"SELECT count(*) AS n FROM {dbutils.widgets.get('catalog')}.silver.orders "
    f"WHERE order_date >= '{dbutils.widgets.get('start_date')}'"
).first()["n"]
dbutils.jobs.taskValues.set(key="order_count", value=n)
```

The same `start_date` parameter read in SQL and in Python:

{{snippet: job-parameter-notebook}}

## Common mistakes

- Using `{{job.parameters.x}}` **inside** a notebook: dynamic values resolve in configuration, code uses `dbutils.widgets.get`.
- Defining a task parameter with the same name as a job parameter and expecting the task's value to win: the job wins.
- Passing a DataFrame or a huge list between tasks via task values: 48 KiB limit, JSON only. Data flows through tables; task values carry metadata (counts, paths, flags).
- Calling `taskValues.get` in a notebook run by hand, without `debugValue`: it errors out.
- Writing `:start_date` with quotes, like `':start_date'`: it becomes a literal string.
- Still using `{{run_id}}` or `{{start_date}}`: deprecated, today they are `{{task.run_id}}` and `{{job.start_time.iso_date}}`.

> [!exam]
> Expect questions on: who wins between a job parameter and a task parameter (the job); how a notebook reads a parameter (`dbutils.widgets.get`); how to pass a result from one task to the next (task values with `dbutils.jobs.taskValues.set` and `{{tasks.<task>.values.<key>}}`); and what `{{job.start_time.iso_date}}` is for (making the job idempotent with respect to the date without computing it in code). Recognize the `:name` syntax for parameters in SQL tasks.
