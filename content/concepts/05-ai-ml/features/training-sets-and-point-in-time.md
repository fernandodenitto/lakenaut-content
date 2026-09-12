---
id: training-sets-and-point-in-time
title: Training sets and point-in-time joins
area: features
level: advanced
summary: How a training set is assembled from feature lookups, why the logged model re-resolves features at scoring time, and how a timestamp key keeps future facts out of training.
prerequisites: [feature-engineering, mlflow-tracking]
related: [feature-engineering, online-feature-store, feature-views, models-in-uc, delta-time-travel]
exams:
  - cert: ml-associate
    domain: "Databricks Machine Learning"
    objective: "Train a model with features from a feature store table."
sources:
  - url: https://docs.databricks.com/aws/en/machine-learning/feature-store/train-models-with-feature-store
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/feature-store/time-series
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/feature-store/on-demand-features
    checked: 2026-09-12
aliases: [training set, create_training_set, FeatureLookup, point-in-time join, as-of join, timeseries_columns, timestamp_lookup_key, lookback_window, label leakage, score_batch, TIMESERIES]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

A **training set** is the object `fe.create_training_set()` returns: a declaration of which feature tables to join to a labelled DataFrame, and on which keys. `training_set.load_df()` materialises it, and `fe.log_model(..., training_set=training_set)` stores the declaration inside the model, so the same joins can be replayed later against whatever the feature tables hold then.

The part that decides whether the model is honest is the timestamp. A **time-series feature table** carries a timestamp key alongside its primary key, and a lookup against it is an **as-of join**: for each label row, the feature values as they stood at that row's time, not the values sitting in the table today. [[feature-engineering]] introduces the mechanics; this page is about what the joins actually do and where they go wrong.

## Why it exists

Two problems, both of which a hand-written join gets wrong.

The first is that a model trained on a joined DataFrame carries no record of where its inputs came from. Six months later nobody can say which table `avg_order_value_30d` came from, so scoring code re-implements the join and drifts from the training code. Embedding the lookups in the model artefact removes the second implementation: `fe.score_batch()` and a serving endpoint both read the declaration the model was logged with.

The second is **label leakage**, and it is the expensive one. Suppose you are predicting churn from a feature table refreshed nightly. Join it naively and every training row gets today's feature values, including facts recorded after the label was observed. A customer who churned in March gets the "support tickets in the last 30 days" figure from September, which is high precisely because they were leaving. The model looks excellent in evaluation and is worthless in production, because at prediction time the future is not available. As-of joins remove that class of error structurally rather than by care.

## How it works

### FeatureLookup

Each `FeatureLookup` names a feature table, the features to take from it, and the columns in your DataFrame that correspond to that table's primary keys:

| Argument | What it does |
| --- | --- |
| `table_name` | three-level name of the feature table |
| `feature_names` | one name, a list, or `None` for every feature except the primary keys, resolved when the training set is created |
| `lookup_key` | column or columns in your DataFrame; type and order must match the table's primary keys, excluding timestamp keys |
| `timestamp_lookup_key` | the column holding the observation time, which turns the join into an as-of join |
| `output_name` | renames the feature, so the same column from two tables can coexist |
| `default_values` | value to use when the lookup finds nothing |
| `lookback_window` | a `datetime.timedelta` beyond which feature values are too old to use |

`create_training_set()` performs a **left join** per lookup, keeps every column of the input DataFrame except those in `exclude_columns`, and adds one column per feature. A model can use at most **50 tables and 100 functions** for training.

A `FeatureFunction` goes in the same `feature_lookups` list and computes a value at inference time from a Unity Catalog Python UDF, binding its arguments to request fields or looked-up features through `input_bindings`.

### Time-series feature tables

From Databricks Runtime 13.3 LTS and above, any Delta table in Unity Catalog with primary keys and a timestamp key is a time-series feature table. You declare the timestamp key either in SQL, with the `TIMESERIES` keyword inside the primary key constraint, or in Python with `timeseries_columns`:

```sql
CREATE TABLE shop.features.customer_daily (
  customer_id STRING NOT NULL,
  event_ts TIMESTAMP NOT NULL,
  orders_30d INT,
  support_tickets_30d INT,
  CONSTRAINT pk_customer_daily PRIMARY KEY (customer_id, event_ts TIMESERIES)
) USING DELTA
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true');
```

```python
fe.create_table(
    name="shop.features.customer_daily",
    primary_keys=["customer_id", "event_ts"],
    timeseries_columns="event_ts",   # without this there is no point-in-time logic
    df=features_df,
)
```

The rules around it are strict, and most of them exist to keep the join cheap:

- the timestamp key must be `TimestampType` or `DateType`, and the table cannot have partition columns;
- Databricks recommends no more than two primary key columns, and liquid clustering from `databricks-feature-engineering` 0.6.0 for lookup performance;
- a `DATE` or `TIMESTAMP` primary key that is **not** declared as a timeseries column makes `create_training_set()`, `create_feature_spec()` and `publish_table()` fail. Either declare it, or change the column to `STRING` if you genuinely want exact-match semantics;
- writes must supply values for every feature in the table, unlike a regular feature table, which keeps the series dense.

### What the as-of join actually returns

For each row of your DataFrame, the lookup matches the primary key exactly and takes the most recent feature row whose timestamp is **not later than** the value in `timestamp_lookup_key`. If no such row exists the feature is `null`, and rows with null feature values are not skipped. Any `FeatureLookup` against a time-series table must pass a `timestamp_lookup_key`.

`lookback_window` narrows that to values no older than a given age, and applies during training and batch inference only: online inference always takes the latest published value, whatever the window says. With Photon enabled, `use_spark_native_join=True` on `create_training_set()` and `score_batch()` speeds the join up, from client version 0.6.0.

This has nothing to do with [[delta-time-travel]], which reads a table as of a commit version. Here the timestamps are data in the table, not metadata about it.

### Logging and scoring

`fe.log_model()` writes the lookups into the model and registers it in [[models-in-uc]]. From then on, `score_batch()` takes a DataFrame of keys and timestamps and re-resolves the features itself. Unity Catalog records the tables and functions used, so the model's lineage shows them in Catalog Explorer.

The DataFrame you pass to `score_batch()` must contain a timestamp column with the same name and type as the `timestamp_lookup_key` used at training time. A real-time endpoint does the same resolution against an [[online-feature-store]].

## Example: a point-in-time training set, logged and scored

```python
from datetime import timedelta
import mlflow
from sklearn import linear_model
from databricks.feature_engineering import FeatureEngineeringClient, FeatureLookup

fe = FeatureEngineeringClient()
mlflow.set_registry_uri("databricks-uc")

feature_lookups = [
    FeatureLookup(
        table_name="shop.features.customer_daily",
        feature_names=["orders_30d", "support_tickets_30d"],
        lookup_key="customer_id",
        timestamp_lookup_key="observed_at",   # as-of join on the label's own time
        lookback_window=timedelta(days=7),   # ignore features older than a week
    ),
]

with mlflow.start_run():
    # labels_df: customer_id, observed_at, churned
    training_set = fe.create_training_set(
        df=labels_df,
        feature_lookups=feature_lookups,
        label="churned",
        exclude_columns=["customer_id", "observed_at"],
    )
    training_df = training_set.load_df().toPandas()
    model = linear_model.LogisticRegression().fit(
        training_df.drop(["churned"], axis=1), training_df.churned
    )
    fe.log_model(
        model=model,
        name="churn_model",
        flavor=mlflow.sklearn,
        training_set=training_set,
        registered_model_name="shop.models.churn",
    )
```

Scoring re-runs the same lookups, so the input needs keys and a timestamp and nothing else:

```python
# batch_df: customer_id, observed_at
predictions = fe.score_batch(model_uri="models:/shop.models.churn@champion", df=batch_df)
```

## Common mistakes

- **Omitting `timestamp_lookup_key` on a table that has a timestamp key.** The call fails rather than silently joining wrongly, which is the good outcome. The bad outcome is never declaring `timeseries_columns` in the first place: then the timestamp is just another primary key and the join demands an exact time match, quietly returning nothing for most rows.
- **Leaving the lookup keys in the training DataFrame.** `customer_id` is an identifier, and a model that learns from it has memorised your customer list. Put it in `exclude_columns`.
- **Joining the feature table by hand "just for this experiment".** That is the leakage path, and the experiment is the thing you later compare production against.
- **Changing `feature_names` to `None` and assuming it is stable.** It expands to the feature list as it stands when the training set is created, so a column added next month silently changes the shape of the next training run.
- **Forgetting the timestamp column in the DataFrame passed to `score_batch()`.** It must carry the same name and data type as the `timestamp_lookup_key` from training.
- **Assuming a missing lookup behaves the same everywhere.** A `FeatureFunction` reading a failed lookup sees `None` under `score_batch()` and `float("nan")` under online serving, so a UDF that only checks for `None` breaks in production. Handle both, or set `default_values`.

> [!exam]
> The Machine Learning Associate guide has separate objectives for training a model with feature store features and scoring one, and both come down to the same API names: `FeatureLookup`, `create_training_set`, `log_model` from the feature client rather than from MLflow, and `score_batch`. Know that the model stores feature references, not feature values, so scoring re-reads the tables. For the point-in-time part, the words to recognise are **timestamp key**, **as-of join** and **label leakage**, and the detail that catches people out is that declaring a timestamp column as a primary key is not enough: without `timeseries_columns` (or `TIMESERIES` in SQL) there is no point-in-time logic at all.
