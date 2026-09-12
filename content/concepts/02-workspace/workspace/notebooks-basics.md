---
id: notebooks-basics
title: Notebooks
area: workspace
subarea: notebooks
level: beginner
summary: A notebook mixes SQL, Python, Scala, and Markdown cells with live results, widgets, and version history, and runs interactively or as a job task.
prerequisites: [platform-architecture, compute-options]
related: [workspace-files-volumes, jobs-overview, sql-editor-basics, spark-sql-basics]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/notebooks/
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/notebooks/notebooks-code
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/notebooks/widgets
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/notebooks/notebook-outputs
    checked: 2026-09-10
aliases: [notebook, magic commands, dbutils.widgets, notebook widgets, ipynb]
updated: 2026-09-10
status: published
---

## What it is

A **notebook** is the default place to write and run code in the [[workspace]]: an ordered list of cells, each holding either code or formatted text, that you execute one at a time or all together against attached compute. One notebook can carry Python, SQL, Scala, and R side by side, keeps every cell's last output saved with the code, and records an automatic revision history in the background.

## Why it exists

Data engineering and analysis are exploratory: you run a query, look at the result, adjust, run again. A notebook keeps code, output, and narrative text (via `%md` cells) in the same document, so the next person can read what happened without re-running everything. It's also the unit the job scheduler understands directly — a notebook can be a [[jobs-overview]] task with no extra packaging — which is why most Databricks tutorials and exam objectives assume you're working in one.

## How it works

### Cells and magic commands

A cell runs in the notebook's **default language**, shown under the notebook title. A magic command on the first line overrides that for a single cell:

| Magic | Effect |
| --- | --- |
| `%python` / `%sql` / `%scala` / `%r` | switch the cell to that language |
| `%md` | render the cell as Markdown (text, images, LaTeX) |
| `%sh` | run a shell command on the driver node only |
| `%run ./utils` | execute another notebook inline, importing its functions and variables |
| `%pip install <pkg>` | install a Python package scoped to the current notebook session |

A cell can carry only one magic command, so `%run` always sits alone. Switching the notebook's default language re-prefixes existing cells written in the old default with an explicit magic command, so nothing silently breaks.

### Mixing languages

Overriding the language per cell is normal — a `%sql` exploration cell inside an otherwise Python notebook is common. The catch: each language keeps its own REPL, so a Python variable is invisible to a SQL cell and vice versa. To cross the boundary, register a temporary view (`df.createOrReplaceTempView(...)`), read `_sqldf` (the DataFrame Databricks automatically creates from the last SQL cell's result), or pass values through a widget.

### Results and inline visualizations

Running a cell shows output in a **results table**: sortable, filterable, searchable, with column pinning and formatting (currency, percentage, URL). From that grid you add a chart with one click, without touching the query — see [[spark-sql-basics]] for the query side and [[dataframe-columns-rows]] for the DataFrame side.

### Widgets and notebook parameters

`dbutils.widgets` creates input controls at the top of the notebook: `text`, `dropdown`, `combobox`, and `multiselect`, all string-valued.

```python
dbutils.widgets.dropdown("environment", "dev", ["dev", "test", "prod"])
env = dbutils.widgets.get("environment")
```

```sql
SELECT * FROM sales WHERE region = :environment
```

When a job runs the notebook as a task, its `base_parameters` are matched to widgets **by name** and override the defaults — this is how a single notebook serves dev, test, and prod without edits (see [[jobs-parameters]]). Run the notebook interactively with no job context and it simply falls back to the widget defaults.

### Version history

The clock icon opens a panel that lists every autosave, lets you name a version and restore it, and diffs two versions. This is **not** the same as a Git commit: it lives inside the notebook object itself and isn't shareable as a pull request. For real collaboration, keep the notebook inside a [[git-folders]] clone and commit deliberately.

### Notebook vs. script vs. SQL editor vs. serverless

| | Notebook | `.py`/`.sql` script | SQL editor |
| --- | --- | --- | --- |
| Mixed languages, inline docs | yes | no | no |
| Cell-by-cell execution | yes | no | per statement |
| Runs as a job task directly | yes | yes (as a file task) | as a query/alert |
| Best for | exploration, ETL logic, ML | packaged, tested code | ad hoc SQL, dashboards ([[sql-editor-basics]]) |

Any notebook can attach to **serverless compute** instead of a cluster. It starts in seconds, needs no sizing, and is the default recommendation unless you need a specific runtime version, init scripts, or GPUs — see [[compute-options]].

## Example

```python
# Cell 1 (default language: Python)
dbutils.widgets.text("min_amount", "100")
min_amount = float(dbutils.widgets.get("min_amount"))
```

```sql
-- Cell 2
%sql
SELECT customer_id, sum(amount) AS total
FROM sales
GROUP BY customer_id
HAVING sum(amount) > :min_amount
```

```python
# Cell 3 — back in Python, reusing the SQL result
top_customers = _sqldf.orderBy("total", ascending=False)
display(top_customers.limit(10))
```

## Common mistakes

- Expecting a Python variable to be visible in a `%sql` cell without a temp view, widget, or `_sqldf`.
- Treating notebook version history as source control: it doesn't produce a reviewable diff outside the notebook and disappears if the notebook is deleted. Use a [[git-folders]] clone.
- Leaving a `%pip install` cell with no pinned version in a production job — it hits PyPI on every run and can silently change behavior.
- Hardcoding a value that should be a widget, which breaks parameterized job runs across environments.
- Forgetting `%run` must be the only content of its cell and can't take arguments — pass values through widgets instead.

> [!tip]
> Start new notebooks on serverless compute by default. You skip cluster startup entirely, and everything in this article — magics, widgets, `%run`, job parameters — behaves the same as on a classic cluster.
