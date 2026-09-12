---
id: data-quality-overview
title: Data quality on Databricks, layer by layer
area: data-quality
level: intermediate
summary: Constraints, expectations, DQX, data profiling and anomaly detection each catch a different failure. What each layer sees, what it costs, and how to choose.
prerequisites: [medallion-architecture, delta-lake-overview]
related: [pipelines-expectations, dqx-framework, gold-layer-objects, runs-monitoring, databricks-labs-tools]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/ldp/expectations
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/tables/constraints
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-quality-monitoring/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-quality-monitoring/data-profiling/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-quality-monitoring/anomaly-detection/
    checked: 2026-09-11
aliases: [data quality, quality layers, data profiling, anomaly detection, quality monitoring]
updated: 2026-09-11
status: published
---

## What it is

"Data quality" on Databricks is not a single product you turn on. It is four different mechanisms, each watching a different moment in the life of a row:

| Layer | Where it runs | Catches | Reaction |
| --- | --- | --- | --- |
| Delta constraints | on the table, for every writer | nulls and predicate violations | the write fails |
| Pipeline expectations | inside a declarative pipeline | rows that break a rule | warn, drop, or fail the update |
| DQX | any PySpark job or stream | the same rules, outside a pipeline | annotate or quarantine |
| Data quality monitoring | after the write, on a schedule | drift, staleness, missing volume | metrics, dashboards, alerts |

The first three act on data **in transit**. The last one watches data **at rest** and tells you that something changed even when every rule still passes.

## Why it exists

Each layer is blind to what the others see. A `CHECK` constraint cannot tell you that the row count dropped by 90%, because every surviving row is valid. An expectation cannot protect a table that someone writes to from a notebook. Profiling cannot stop anything, it can only report afterwards. Choosing one and calling it "data quality" is how a pipeline ends up green while the dashboard is wrong.

## How it works

### Delta constraints: the floor

`NOT NULL` and `CHECK` live in the table definition, so they apply to every writer, in every language, forever. Violating one fails the transaction. They are cheap and absolute, which is exactly why they should hold only the rules that are true by definition: a primary key is not null, an amount is not negative. See [[pipelines-expectations]] for the syntax and for what happens to an existing table when you add one.

### Expectations: the pipeline's own rules

Inside a Lakeflow pipeline (the product formerly called Delta Live Tables), an expectation is a named boolean condition with an action: keep the row and count the violation, drop the row, or fail the update. Results land in the event log, so "how many rows failed `valid_amount` last week" is a query, not an archaeology project. This is the default choice for anything that already runs as a pipeline.

### DQX: the same discipline for everything else

[[dqx-framework]] applies named rules to any PySpark DataFrame or table, batch or streaming, and splits valid rows from quarantined ones. Use it when the data never touches a declarative pipeline, or when the same rule set has to be shared by several jobs and owned as configuration rather than code.

### Data quality monitoring: the trend

Unity Catalog groups two features under **data quality monitoring**, and they are not the same maturity.

**Data profiling** is the feature formerly called Lakehouse Monitoring. Attach a monitor to a table and it computes summary statistics on a schedule, writing two Delta tables: a **profile metrics** table with the statistics and a **drift metrics** table comparing each window with the previous one and with a baseline. Three monitor types cover the cases: **time series** for timestamped data, **inference** for model request logs, and **snapshot** for everything else. Because the output is a table, alerts and dashboards are ordinary queries over it. It is generally available, though not in every region.

**Anomaly detection** works at the **schema** level rather than per table and is in Public Preview as of September 2026. It learns two things from history: **freshness**, how recently a table is usually updated, and **completeness**, how many rows normally arrive in a day. It then flags tables that went quiet or arrived thin. This is the layer that catches an upstream job that silently stopped, which no row-level rule can see. Both are billed as serverless compute, so a monitor on every table is a cost decision, not a free win.

### Outside the platform

Several mature open-source frameworks solve the same problem, and are worth knowing if the team already uses one or if the rules have to run somewhere other than Databricks.

| Framework | Shape | Why you would pick it over DQX |
| --- | --- | --- |
| Great Expectations (GX Core) | Expectation suites plus generated documentation, many backends | The team already has suites, or you want the data docs as an artefact. Note that stewardship moved to Fivetran in May 2026 |
| Soda Core | Checks in YAML, positioned around data contracts | You want contracts between teams, with a commercial cloud for the reporting side |
| spark-expectations (Nike) | In-process Spark rules with quarantine and statistics tables | The closest thing to DQX outside Labs: rules live in a table, alerting goes to Kafka or email |
| Deequ and PyDeequ (AWS) | Scala-first "unit tests for data", with a metrics repository | You want constraint suggestion and anomaly detection over a history of metrics, on any Spark, not only Databricks |
| Pandera | Schema and statistical typing for pandas, Polars and PySpark | The rules are really a schema contract in code, checked in CI as well as in the job |

None of them know about Unity Catalog, Lakeflow pipelines or workspace deployment, which is the one thing [[dqx-framework|DQX]] gets for free.

## Choosing

- The rule is **true by definition** and must hold for every writer: a Delta constraint.
- The rule belongs to **one pipeline** and you want it in the event log: an expectation.
- The rule has to run **outside a pipeline**, or be shared across jobs, or produce a quarantine table: [[dqx-framework]].
- You want to know when the data **changes shape** rather than breaks: data profiling.
- You want to be told when a table **goes quiet** without writing any rule: anomaly detection.

Most teams end up with a constraint layer of five rules, expectations or DQX at the bronze-to-silver boundary, and profiling on the gold tables the business actually reads.

## Common mistakes

- **Only checking at the end.** A quality rule on gold tells you the number is wrong. A rule at the silver boundary tells you which source row made it wrong.
- **Rules with no owner.** Every rule needs a name, a severity and someone who is expected to look when it fires. A rule that fires weekly and is ignored is worse than no rule, because it trains everybody to ignore the alert channel.
- **Confusing profiling with enforcement.** Profiling never blocks a write. If the requirement is "this must not be possible", it is a constraint.
- **Building a bespoke framework.** Between expectations, DQX and profiling, the interesting work left is the rules themselves, not the runner.

> [!note]
> The exams cover expectations and constraints, not DQX, profiling or anomaly detection. The distinction is still worth knowing: exam questions about "reliable silver and gold" are asking about the first two layers.
