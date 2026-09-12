---
id: feature-views
title: Feature Views
area: features
level: advanced
summary: Declarative features, defined as a source plus an aggregation over a time window, registered in Unity Catalog and materialised by managed pipelines rather than by a table you build yourself.
prerequisites: [feature-engineering, training-sets-and-point-in-time]
related: [feature-engineering, training-sets-and-point-in-time, online-feature-store, pipelines-overview, kafka-streaming]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/machine-learning/feature-store/feature-views
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/feature-store/declarative-apis
    checked: 2026-09-12
aliases: [feature views, declarative feature engineering, declarative apis, create_feature, materialize_features, RollingWindow, SlidingWindow, TumblingWindow, SawtoothWindow, RequestSource, ColumnSelection, AggregationFunction]
updated: 2026-09-12
status: published
maturity: public-preview
maturity_checked: 2026-09-12
---

## What it is

A **Feature View** is a feature described rather than built. Instead of writing a job that aggregates a source table and writes the result to a feature table, you declare four things: a **source**, an **entity** to group by, a **timeseries column** to order by, and a **function**, usually an aggregation over a time window. Databricks registers that definition as a Unity Catalog object and, when you ask it to, runs the pipeline that keeps it computed.

> [!note]
> This is in Public Preview as of September 2026, and a workspace admin controls access to it from the Previews page. `SawtoothWindow` inside it is Beta. It can change without notice and it is not on any exam guide. Read it to know it exists, not to build on it.

The rest of the feature store is unchanged around it. The definitions still feed `create_training_set()`, the results still land in an offline table or an [[online-feature-store]], and the point-in-time semantics described in [[training-sets-and-point-in-time]] still apply. What changes is who writes the aggregation.

## Why it exists

A feature table as described in [[feature-engineering]] is a table you own. Somebody wrote the SQL for "average transaction value over 30 days", somebody scheduled it, and somebody will be asked in a year's time whether the window is calendar days or rolling, whether late-arriving rows are reprocessed, and why the online copy is an hour behind. The definition of the feature lives in pipeline code, so the only way to read it is to read the pipeline.

Declaring the feature moves the window and the aggregation into metadata that both the training path and the serving path read. Two consequences follow. A feature computed for training and a feature served online come from one declaration rather than two implementations, which is the same skew argument one level up. And the definition becomes greppable: "which features use a 7-day window" is a question about objects in Unity Catalog rather than an archaeology exercise across notebooks.

The second reason is windowed aggregation over streams. Writing a correct 30-day rolling sum that is also fresh within a second is genuinely hard, and the declarative API has an implementation of it that you do not have to maintain.

## How it works

You need serverless compute or a classic cluster on Databricks Runtime 17.0 ML or above, plus the client:

```python
%pip install databricks-feature-engineering>=0.16.0
dbutils.library.restartPython()
```

### Sources

| Source | What it reads | Freshness |
| --- | --- | --- |
| `DeltaTableSource` | a Delta table in Unity Catalog | batch on a schedule, or tens of seconds with streaming materialisation |
| `StreamSource` | a Stream, backed by Kafka, referenced by its three-part name | p99 end-to-end around 200 ms |
| `RequestSource` | data that only exists in the scoring request | computed per request |

A `StreamSource` sits on top of [[kafka-streaming|a Kafka stream]] and keeps an ingestion Delta table as the historical copy used for training; column references into it are prefixed with the Kafka message part, so `value.user_id` rather than `user_id`. `filter_condition` drops rows before aggregation, and `transformation_sql` applies a row-wise Spark SQL projection first.

`RequestSource` is the narrowest of the three on purpose: scalar types only, and `ColumnSelection` only, so no aggregations and no windows over request data.

### Functions and windows

An `AggregationFunction` pairs an operator with a window. The operators are `Sum`, `Avg`, `Count`, `Min` and `Max`; `ColumnSelection` is the non-aggregating alternative and passes through the latest value per entity key.

| Window | Computation | Works with |
| --- | --- | --- |
| `TumblingWindow` | fixed, non-overlapping intervals | batch sources |
| `SlidingWindow` | overlapping intervals, `window_duration` plus `slide_duration` | batch sources |
| `RollingWindow` | continuous recomputation over the most recent data | batch and streaming |
| `SawtoothWindow` (Beta) | long windows kept fresh cheaply | streaming |

Tumbling and sliding windows do not work over a streaming source, and they are the more scalable pair, so the documented advice is to start with a sliding window and reach for a rolling one only when the window is short and must be continuous. A `SawtoothWindow` exists for the opposite case: `window_duration` must exceed two days, it is recommended above seven, and it works by serving most of the window from the Stream's ingestion table and only the last two days from the live stream, so it never recomputes the whole window per event. It needs the ingestion table to already hold the full window, and takes roughly two days from the start of materialisation before it can serve.

`delay` on a window shifts it into the past, which is how you build "the same 7 days, four weeks ago" as a feature next to the current one.

### Registering and materialising

`Feature(...)` builds a definition locally, and `fe.compute_features()` evaluates it without registering anything, which is the loop to develop in. `fe.register_feature()` persists a local definition to Unity Catalog; `fe.create_feature()` defines and registers in one call. A feature must be registered before it can be materialised.

`fe.materialize_features()` is where the managed pipeline appears, playing the role your own [[pipelines-overview|declarative pipeline]] would otherwise play. It takes an `OfflineStoreConfig`, an `OnlineStoreConfig`, or both, each naming a catalog, a schema and a `table_name_prefix`, with the online config also naming the online store. The trigger decides how the pipeline runs:

- `CronSchedule(quartz_cron_expression=..., timezone_id=...)` for batch aggregations;
- `TableTrigger()` to recompute when the source table changes, which is the only trigger `ColumnSelection` features support, and they materialise online only;
- `StreamingMode()` for continuous materialisation from a `DeltaTableSource`, which requires [[change-data-feed|change data feed]] on that table.

Streaming features never materialise to an offline store. For training and batch inference the values are computed from the source instead, so a streaming feature needs an `online_config` and rejects an `offline_config`. Streaming and batch features cannot share one `materialize_features` call. And streaming materialisation does not backfill: it starts from records arriving after the pipeline starts, so a rolling aggregate is only complete once a full window has passed.

## Example: two batch features and one served online

```python
from datetime import timedelta
from databricks.feature_engineering import FeatureEngineeringClient
from databricks.feature_engineering.entities import (
    AggregationFunction, ColumnSelection, CronSchedule, DeltaTableSource,
    OfflineStoreConfig, OnlineStoreConfig, SlidingWindow, Sum, TableTrigger,
)

fe = FeatureEngineeringClient()

source = DeltaTableSource(catalog_name="shop", schema_name="silver", table_name="transactions")

spend_7d = fe.create_feature(
    catalog_name="shop",
    schema_name="features",
    name="spend_sum_7d",
    source=source,
    entity=["customer_id"],
    timeseries_column="transaction_time",
    function=AggregationFunction(
        Sum(input="amount"),
        SlidingWindow(window_duration=timedelta(days=7), slide_duration=timedelta(days=1)),
    ),
)

last_amount = fe.create_feature(
    catalog_name="shop",
    schema_name="features",
    name="latest_amount",
    source=source,
    entity=["customer_id"],
    timeseries_column="transaction_time",
    function=ColumnSelection("amount"),
)

online_config = OnlineStoreConfig(
    catalog_name="shop",
    schema_name="features",
    table_name_prefix="customer_serving",
    online_store_name="shop-online-store",
)

fe.materialize_features(
    features=[spend_7d],
    offline_config=OfflineStoreConfig(
        catalog_name="shop", schema_name="features", table_name_prefix="customer_batch"
    ),
    online_config=online_config,
    trigger=CronSchedule(quartz_cron_expression="0 0 * * * ?", timezone_id="UTC"),  # hourly
)

# A ColumnSelection feature takes TableTrigger and materialises online only.
fe.materialize_features(features=[last_amount], online_config=online_config, trigger=TableTrigger())
```

Training reads the same definitions through the `features` argument rather than `feature_lookups`:

```python
training_set = fe.create_training_set(df=labels_df, features=[spend_7d, last_amount], label="churned")
```

## Common mistakes

- **Treating it as the new default.** It is in Public Preview, and a preview is not where a production feature pipeline goes. A hand-built feature table is the boring, generally available answer.
- **Using a `DATE` or `TIMESTAMP` column as the entity.** Entity columns cannot be either type. The timeseries column is where time belongs.
- **Expecting a streaming feature in the offline store.** It is not there and will not be. Training values are recomputed from the source, so plan for the source to hold enough history.
- **Starting a streaming materialisation and reading the aggregate straight away.** Nothing is backfilled, so a rolling window is only correct after one full window has elapsed, and a sawtooth window takes about two days.
- **Renaming columns between the labelled DataFrame and the definitions.** Entity and timeseries column names must match, and the label column must not exist in any source table. Both are reported as errors rather than wrong numbers, but only when you get to `create_training_set()`.
- **Materialising features from one source in several calls.** Each call scans the source. Group features that share a source, and keep slide durations at one granularity so they can be computed together.

> [!tip]
> The honest use of this page today is to recognise the shape. If you find yourself writing a job whose only content is a windowed aggregation per entity key, note that Databricks is building a declarative replacement for it, and write the job so the window and the key are easy to find when the preview lands.
