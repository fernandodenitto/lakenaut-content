---
id: online-feature-store
title: Online Feature Store
area: features
level: intermediate
summary: The low-latency half of the feature store, a Lakebase-backed copy of a feature table that a serving endpoint reads by primary key on every request.
prerequisites: [feature-engineering, model-serving-endpoints]
related: [feature-engineering, training-sets-and-point-in-time, model-serving-endpoints, change-data-feed, models-in-uc]
exams:
  - cert: ml-associate
    domain: "Databricks Machine Learning"
    objective: "Describe the differences between online and offline feature tables."
sources:
  - url: https://docs.databricks.com/aws/en/machine-learning/feature-store/online-feature-store
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/feature-store/automatic-feature-lookup
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/feature-store/feature-function-serving
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/feature-store/on-demand-features
    checked: 2026-09-12
aliases: [online tables, online table, online store, publish_table, create_online_store, feature serving endpoint, FeatureSpec, automatic feature lookup, lakebase autoscaling, capacity units]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

An **Online Feature Store** is the low-latency half of the feature store described in [[feature-engineering]]. An offline feature table is an ordinary Delta table in Unity Catalog: columnar, cheap to scan, and the wrong shape for fetching one row by key inside a request budget of a few milliseconds. The online store is a managed copy of that table, keyed by primary key, provisioned as a **Lakebase Autoscaling** project that shares its name with the store.

Two things read it. A [[model-serving-endpoints|model serving endpoint]] uses it for **automatic feature lookup**: the caller sends only the keys, the endpoint fetches the features and scores the assembled row. A **feature serving endpoint** uses it to hand the feature values themselves to an application, with no model in the path.

The old name was **online tables**. The former documentation URL now redirects to the online feature store page, and material written before the change, the Machine Learning Associate exam guide included, still says online table.

## Why it exists

Without an online store, the application calling the endpoint has to put the feature values in the request body. That means the application computes "orders in the last 30 days" itself, which is exactly the training/serving skew that the feature store exists to remove, only now it lives in the caller rather than in the training notebook. It also means every client needs read access to feature data it has no business seeing.

Publishing the table moves the join inside the endpoint. The request then carries identity (`customer_id`), not state, and there is one implementation of the feature left in the building.

The reason this needs a separate engine rather than a query against the Delta table is the access pattern. Delta is built to read many rows from few files; a single-key lookup pays file opening and metadata cost that a batch job absorbs happily and an online request cannot. The online store is a key-value read path with the same values in it.

## How it works

### Creating a store

You need Databricks Runtime 16.4 LTS ML or above, or serverless compute, and the client:

```python
%pip install databricks-feature-engineering>=0.13.0
dbutils.library.restartPython()
```

```python
from databricks.feature_engineering import FeatureEngineeringClient

fe = FeatureEngineeringClient()
fe.create_online_store(name="shop-online-store", capacity="CU_2")
```

`capacity` is one of `CU_1`, `CU_2`, `CU_4`, `CU_8`, in compute units. Databricks suggests starting at `CU_2` and moving on measurements rather than guesses; `fe.update_online_store(name=..., capacity="CU_4")` changes it in place. `fe.list_online_stores()` and `fe.get_online_store()` report name, state and capacity, and `fe.delete_online_store()` removes the store. A store supports up to 3 read replicas, so 4 compute instances including the primary. Names are capped at 63 bytes, and so is each part of an online table's three-level name.

One number-free fact matters more than any of the above: Lakebase **scale-to-zero is not supported** for an online store. It bills from creation until you delete it, whether or not a single request arrives.

### Publishing a feature table

The source table must have a primary key constraint, non-nullable primary key columns, and change data feed enabled for the two incremental modes (see [[change-data-feed]]):

```sql
ALTER TABLE shop.features.customer_30d
  SET TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true');

ALTER TABLE shop.features.customer_30d
  ALTER COLUMN customer_id SET NOT NULL;
```

`fe.publish_table()` then creates and feeds the online copy, in one of three modes:

| Mode | How it updates | What it costs | Use it for |
| --- | --- | --- | --- |
| `TRIGGERED` (default) | reads the change data feed and applies only the changes, on an API call or on a schedule | one pipeline run per sync, nothing between runs | features a batch job refreshes |
| `CONTINUOUS` | a streaming pipeline applies changes as they land in the offline table | compute held open continuously | features that must be seconds old |
| `SNAPSHOT` | one full copy of the source table, once | a single full read and write | the initial load, or after a rewrite |

An online table's catalog name must match its underlying database name, and only feature tables in Unity Catalog can be published. Deleting one goes through the SDK rather than the feature client: `w.feature_store.delete_online_table(online_table_name=...)`.

### Automatic lookup at request time

The endpoint can only resolve features if the model was logged with `fe.log_model(...)`, which packages the `FeatureLookup` list into the model artifact (see [[training-sets-and-point-in-time]]). A model logged with plain `mlflow.sklearn.log_model` carries no feature metadata, and its endpoint will demand every feature in the payload.

Looked-up features can be `IntegerType`, `FloatType`, `BooleanType`, `StringType`, `DoubleType`, `LongType`, `TimestampType`, `DateType`, `ShortType`, `ArrayType` or `MapType`. Amazon DynamoDB also works as a third-party store, from client version 0.3.8, with read-only credentials held in a secret scope.

Two behaviours are worth committing to memory. Any feature you include in the request payload **overrides** the looked-up value, as long as it matches the type the model expects. And an online lookup always returns the latest published value: the `lookback_window` that limits feature age during training does not apply here. For endpoints created after February 2025, the augmented row, looked-up features and function outputs included, can be written to the inference table, which is what makes [[model-monitoring]] possible over a feature-backed model.

### Feature serving endpoints

When the consumer wants features rather than predictions, you publish a **FeatureSpec**: a Unity Catalog object listing `FeatureLookup` entries and `FeatureFunction` entries, the latter being Python UDFs evaluated at request time from looked-up values and request fields.

```python
from databricks.feature_engineering import FeatureEngineeringClient, FeatureFunction, FeatureLookup

fe = FeatureEngineeringClient()
fe.create_feature_spec(
    name="shop.features.customer_features",
    features=[
        FeatureLookup(
            table_name="shop.features.customer_30d",
            lookup_key="customer_id",
            feature_names=["orders_30d", "avg_order_value_30d"],
        ),
        FeatureFunction(
            udf_name="shop.features.spend_gap",
            output_name="spend_gap",
            input_bindings={"num_1": "ytd_spend", "num_2": "avg_order_value_30d"},
        ),
    ],
)
```

Serving it needs Databricks Runtime 14.2 ML or above, `databricks-feature-engineering` 0.1.2 or later and `databricks-sdk` 0.18.0 or later. `fe.create_feature_serving_endpoint()` takes an `EndpointCoreConfig` with a `ServedEntity` naming the FeatureSpec, a `workload_size` and `scale_to_zero_enabled`. Change one with `update_config`, never by deleting and recreating: deletion is irreversible and takes the endpoint down at once.

## Example: publish a table, then serve the model that reads it

```python
from databricks.feature_engineering import FeatureEngineeringClient

fe = FeatureEngineeringClient()

fe.create_online_store(name="shop-online-store", capacity="CU_2")
online_store = fe.get_online_store(name="shop-online-store")

# TRIGGERED: syncs the change data feed on demand or on a schedule.
fe.publish_table(
    online_store=online_store,
    source_table_name="shop.features.customer_30d",
    online_table_name="shop.features.customer_30d_online",
    publish_mode="TRIGGERED",
)
```

Query the model endpoint with keys only. The features never appear in the request:

```python
import mlflow.deployments

client = mlflow.deployments.get_deploy_client("databricks")
client.predict(
    endpoint="churn-model",
    inputs={"dataframe_records": [{"customer_id": "12345"}]},
)
```

## Common mistakes

- **Publishing without change data feed on the source table.** `TRIGGERED` and `CONTINUOUS` are both built on the feed. Turn it on before the first publish, not after the endpoint starts failing.
- **Reaching for `CONTINUOUS` because it sounds safer.** It holds a streaming pipeline open for updates that, for a daily aggregate, arrive once. `TRIGGERED` on a schedule does the same job for a fraction of the compute.
- **Budgeting as though the store scales to zero.** It does not. An online store left behind after an experiment is a standing bill; delete it.
- **Logging the model with the MLflow flavour API instead of `fe.log_model`.** Nothing fails at training time. It fails at the endpoint, which has no idea any features exist and asks the caller for all of them.
- **Using `SNAPSHOT` on a schedule to keep the store fresh.** Every run copies the whole table. Use it for the first load and switch to `TRIGGERED` afterwards.
- **Expecting a point-in-time lookup online.** The online path returns the newest value for the key, full stop. As-of semantics belong to training, in [[training-sets-and-point-in-time]].

> [!exam]
> The Machine Learning Associate guide asks for the difference between **online and offline feature tables**: the offline table is the Delta table in Unity Catalog used to build training sets and score batches, the online copy is the low-latency key-value read path a real-time endpoint uses. Know that the online copy is created by publishing an existing feature table, not by writing to it directly, and that the guide predates the rename, so a question saying "online table" means this. Remember `create_online_store` and `publish_table` by name, the three publish modes `TRIGGERED`, `CONTINUOUS` and `SNAPSHOT`, and that the model must be logged with `fe.log_model` for the endpoint to look anything up.
