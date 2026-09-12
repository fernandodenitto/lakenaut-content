---
id: python-in-notebooks
title: "Python in notebooks: dbutils, widgets, modules"
area: foundations-python
level: beginner
summary: How dbutils, widgets, and %pip fit into a Databricks notebook, and how to structure code so it survives the move to a proper module.
prerequisites: [pyspark-vs-pandas, compute-options]
related: [jobs-overview, jobs-parameters, dataframe-io]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/dev-tools/databricks-utils
    checked: 2026-09-10
aliases: [dbutils, widgets, "%pip install", "%run", notebook-scoped libraries, restartPython]
updated: 2026-09-10
status: published
---

## What it is

A Databricks notebook is a Python (or SQL, Scala, R) session attached to a cluster, split into cells, plus a set of platform-specific helpers that don't exist in a plain `.py` script: `dbutils`, widgets, and magic commands like `%pip` and `%run`. None of this is Spark itself — it's the layer that makes a notebook a convenient place to develop, separate from the DataFrame API you use once code is running.

## Why it exists

A notebook needs to do things a script rarely does interactively: install a library for this session only, expose parameters so the same notebook runs for different dates or tables without editing code, move files around before Spark reads them, chain notebooks together, and read secrets without hardcoding credentials. `dbutils` bundles those as one namespace instead of scattering them across separate libraries.

## How it works

### `dbutils` submodules

| Submodule | Purpose | Example |
| --- | --- | --- |
| `dbutils.fs` | List, copy, move files on cluster-attached storage | `dbutils.fs.ls("/Volumes/main/default/raw")` |
| `dbutils.widgets` | Define and read notebook parameters | `dbutils.widgets.text("run_date", "2026-09-10")` |
| `dbutils.notebook` | Run another notebook and get its return value | `dbutils.notebook.run("clean_orders", timeout_seconds=600)` |
| `dbutils.jobs.taskValues` | Pass small values between tasks in a job | `dbutils.jobs.taskValues.set("row_count", 1200)` |
| `dbutils.secrets` | Read credentials from a secret scope | `dbutils.secrets.get(scope="etl", key="api_token")` |

`dbutils.fs` overlaps with plain Python's `os`/`pathlib`, but talks to cloud storage and volumes uniformly across backends — it isn't a replacement for `os` on the driver's local disk.

### Widgets

A widget (`dbutils.widgets.text/dropdown/combobox/multiselect`) creates a control at the top of the notebook and a value you read back with `dbutils.widgets.get("name")`. This is what turns a hardcoded notebook into one a Lakeflow Job can call with different parameters per run (see [[jobs-parameters]]) instead of maintaining a copy per environment.

### Libraries: `%pip install` and restarting Python

`%pip install some-package` installs a library scoped to the current session only — it doesn't touch the cluster for anyone else, and disappears when the session detaches. Because Python loads a module once per process, upgrading a package mid-session usually needs `dbutils.library.restartPython()` afterward; this clears local Python state but leaves Spark and table state untouched.

### `%run` versus `dbutils.notebook.run`

Both let one notebook use another, but they're not interchangeable:

| | `%run ./helpers` | `dbutils.notebook.run("helpers", 60)` |
| --- | --- | --- |
| Executes in | Same session, same variables | Separate, isolated job run |
| Shares variables/functions back | Yes | No — only a string return value |
| Accepts parameters | No | Yes, as a dict |
| Use case | Shared functions, constants used inline | A step that should run independently, possibly retried on its own |

### From notebook to module

A notebook full of `dbutils.widgets` calls and top-level code is hard to unit test and can't be imported. Isolating logic into plain functions in a `.py` file — imported once that file sits in the same Repo/Git folder, or installed as a package — keeps the notebook itself a thin entry point: read widgets, call functions, write output. That split is what lets the same logic later ship as a wheel dependency for a job instead of being copy-pasted between notebooks.

### `display()` versus `show()`

`df.show()` is plain Spark: a fixed-width text dump to the console. `display()` is a Databricks notebook feature: a rich, sortable table with one-click charts — but it only exists inside a notebook, so code meant to run as a plain script or job task shouldn't depend on it.

## Example

```python
dbutils.widgets.text("run_date", "2026-09-10", "Run date")
run_date = dbutils.widgets.get("run_date")

orders = spark.table("shop.silver.orders").filter(f"order_date = '{run_date}'")
display(orders)          # rich, interactive — notebook only
orders.show(5)            # plain text — works anywhere Spark runs

row_count = orders.count()
dbutils.jobs.taskValues.set(key="row_count", value=row_count)
```

```python
# helpers.py, imported like a normal module from a Git folder.
def clean_orders(df):
    return df.dropna(subset=["order_id"]).dropDuplicates(["order_id"])
```

```python
# In the notebook: reusable logic stays testable outside the notebook.
from helpers import clean_orders
silver_orders = clean_orders(spark.table("shop.bronze.orders"))
```

## Common mistakes

- Using `%run` when the goal is an isolated, parameterized, independently retriable step — that's what `dbutils.notebook.run` or a separate job task (see [[jobs-overview]]) is for.
- Forgetting `dbutils.library.restartPython()` after `%pip install`, then wondering why the old version of a package is still active.
- Reading a widget value without a default and without checking it's been created first, which raises on a fresh session.
- Leaving business logic as top-level notebook code instead of functions in a module — untestable, and it can't be reused when the pipeline moves to a wheel-based job.
- Calling `display()` inside code meant to run outside a notebook UI (a wheel task, a plain script) — it isn't defined there.

> [!tip]
> Keep the notebook thin: widgets in, a call to imported functions, `display()` for a human to check the result. The moment logic is worth testing or reusing, it belongs in a `.py` module, not in notebook cells.
