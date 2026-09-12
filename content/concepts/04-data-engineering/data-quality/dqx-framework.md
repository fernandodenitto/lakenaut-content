---
id: dqx-framework
title: "DQX: data quality checks for PySpark"
area: data-quality
level: intermediate
summary: The Databricks Labs framework that validates PySpark DataFrames and tables, splits the good rows from the bad ones, and explains every failure row by row.
prerequisites: [pipelines-expectations, dataframe-columns-rows]
related: [data-quality-overview, pipelines-expectations, medallion-architecture, structured-streaming-basics, databricks-labs-tools]
exams: []
sources:
  - url: https://databrickslabs.github.io/dqx/
    checked: 2026-09-11
  - url: https://databrickslabs.github.io/dqx/docs/guide/quality_checks_apply/
    checked: 2026-09-11
  - url: https://databrickslabs.github.io/dqx/docs/guide/quality_checks_definition/
    checked: 2026-09-11
  - url: https://github.com/databrickslabs/dqx
    checked: 2026-09-11
aliases: [dqx, databricks-labs-dqx, DQEngine, quarantine, data quality framework]
updated: 2026-09-11
status: published
---

## What it is

DQX is a data quality framework from Databricks Labs. You describe rules, it applies them to a PySpark DataFrame or a Unity Catalog table, and it hands back the same rows plus two columns explaining what failed: `_errors` and `_warnings`. From there you either keep everything in one table with the verdict attached, or split the data into a clean set and a quarantine set.

It is an open-source project on PyPI as `databricks-labs-dqx`, not a platform feature: no SLA, no support ticket, and you pin the version yourself.

## Why it exists

[[pipelines-expectations]] are excellent, but they only exist **inside** a declarative pipeline. Plenty of data never goes through one: a notebook that reads an API, a job that writes a feature table, a stream that lands events straight into bronze. For that code the usual answer is a hand-rolled `filter` plus a `count` and a `raise`, written slightly differently by everyone on the team.

DQX gives that job the same vocabulary a pipeline has: named rules, a severity, a record of which rule failed on which row, and metrics you can chart. And it works on the data **in transit**, before it is written, which is the difference between quarantining 400 bad rows and explaining to a analyst why yesterday's gold table was wrong.

## How it works

### A check has three parts

Every check names a **function** (`is_not_null`, `is_unique`, `regex_match`, `is_in_range`, plus 80-odd others and your own), the **column or columns** it applies to, and a **criticality**:

| Criticality | Where the failure is reported | What happens to the row |
| --- | --- | --- |
| `warn` | `_warnings` column | stays in the valid output |
| `error` | `_errors` column | goes to quarantine when you split |

Row-level rules (`DQRowRule`) look at one row at a time. Dataset-level rules (`DQDatasetRule`) need the whole DataFrame, because uniqueness and referential integrity cannot be decided row by row. Both run together in one pass, and each rule is evaluated independently: one broken rule does not stop the others.

### Rules as code, or as configuration

The same rule set can be written as Python objects or as YAML/JSON metadata. Metadata is what you want as soon as someone who is not an engineer owns the rules, because it can live in a Unity Catalog table, a Volume, or a workspace file, and be loaded at run time instead of redeployed.

```python
from databricks.labs.dqx import check_funcs
from databricks.labs.dqx.engine import DQEngine
from databricks.labs.dqx.rule import DQRowRule, DQDatasetRule
from databricks.sdk import WorkspaceClient

dq = DQEngine(WorkspaceClient())

checks = [
    DQRowRule(criticality="warn", check_func=check_funcs.is_not_null, column="city"),
    DQRowRule(
        name="email_invalid_format",
        criticality="error",
        check_func=check_funcs.regex_match,
        column="email",
        check_func_kwargs={"regex": r"^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$"},
    ),
    DQDatasetRule(criticality="error", check_func=check_funcs.is_unique, columns=["order_id"]),
]

orders = spark.read.table("main.bronze.orders")
valid_df, quarantine_df = dq.apply_checks_and_split(orders, checks)
```

The same three rules as metadata:

```yaml
- criticality: warn
  check:
    function: is_not_null
    arguments:
      column: city
- name: email_invalid_format
  criticality: error
  check:
    function: regex_match
    arguments:
      column: email
      regex: ^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$
- criticality: error
  check:
    function: is_unique
    arguments:
      columns:
        - order_id
```

Loaded with `yaml.safe_load` and applied with `apply_checks_by_metadata` or `apply_checks_by_metadata_and_split`, they behave identically.

### What comes out

`apply_checks` returns one DataFrame with every input row and the two result columns. `apply_checks_and_split` returns a pair: the rows with no `error`, and the rows that failed at least one. Each entry in `_errors` and `_warnings` is a struct, so the failures are queryable rather than a string you have to parse:

```python
import pyspark.sql.functions as F

(quarantine_df
    .select(F.explode("_errors").alias("issue"))
    .select("issue.name", "issue.function", "issue.columns", "issue.message")
    .groupBy("name", "function")
    .count()
    .orderBy(F.desc("count"))
    .show())
```

The column names `_errors`, `_warnings` and `_dq_info` are the defaults and can be renamed through `ExtraParams`, which matters if your bronze tables already use those names.

### End to end, without plumbing

`apply_checks_and_save_in_table` reads an input location, applies the rules, and writes the valid rows and the quarantined rows to two tables in one call, with `InputConfig` and `OutputConfig` describing the locations. Rules can be passed in or loaded from `checks_location`. The same methods work on a streaming DataFrame, so a bronze-to-silver stream gets the same checks as the nightly batch.

### The parts you grow into

- **Profiling**: point DQX at an existing table and it collects statistics and proposes a candidate rule set, which is a far better starting point than a blank file.
- **Summary metrics**: input, error, warning and valid row counts per run, written to a Delta table, with an AI/BI dashboard and threshold alerts to Slack, Teams or a webhook.
- **Storage of rules**: YAML or JSON files, a Unity Catalog table, a Volume, or Lakebase.
- **DQX Studio**: a no-code UI deployed as a Databricks App for people who own the rules but not the notebook.

## Example: quarantine at the bronze-to-silver boundary

```python
from databricks.labs.dqx.config import InputConfig, OutputConfig

dq.apply_checks_by_metadata_and_save_in_table(
    checks=checks,
    input_config=InputConfig(location="main.bronze.orders"),
    output_config=OutputConfig(location="main.silver.orders"),
    quarantine_config=OutputConfig(location="main.quality.orders_quarantine"),
)
```

Silver now only contains rows that passed every `error` rule, and the rejected ones are still on disk with the reason attached, which is what makes a quality problem fixable instead of merely visible. See [[medallion-architecture]] for why that boundary is the right place for it.

## Common mistakes

- **Marking everything `error`.** A rule that quarantines 30% of the rows on day one is a rule nobody will keep. Start at `warn`, watch the counts, promote the rules that stay quiet.
- **Using DQX where an expectation belongs.** Inside a declarative pipeline, [[pipelines-expectations]] are already wired into the event log and the pipeline UI. Reach for DQX when the data does not pass through a pipeline, or when the rules have to be shared across jobs.
- **Forgetting it is not a platform feature.** Pin the version, test the upgrade. A Labs project can change an API between minor releases, and nobody is on call for it.
- **Quarantining without a way back.** A quarantine table that nobody reads is a delete with extra steps. Give it an owner, a dashboard, and a route for reprocessing fixed rows.
- **Expecting a constraint.** DQX validates data as it flows; it does not stop somebody else writing straight to the table. That is what Delta `CHECK` and `NOT NULL` constraints are for.

> [!note]
> DQX is not on any certification exam guide, and Databricks Labs projects are not formally supported. It is here because it answers a question the exams leave open: how do you check quality in the code that is not a declarative pipeline.
