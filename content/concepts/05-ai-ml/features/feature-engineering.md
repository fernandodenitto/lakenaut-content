---
id: feature-engineering
title: Feature engineering and the feature store
area: features
level: intermediate
summary: Feature tables in Unity Catalog let a team compute a feature once and reuse the exact same values for training and for real-time serving.
prerequisites: [unity-catalog-overview, dataframe-joins-unions]
related: [mlflow-tracking, models-in-uc, model-serving-endpoints, medallion-architecture]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/machine-learning/feature-store/online-feature-store
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/feature-store/
    checked: 2026-09-10
aliases: [feature store, feature tables, FeatureEngineeringClient, point-in-time join, online store, online tables, online feature store, lakebase, publish_table, training/serving skew]
updated: 2026-09-12
status: published
---

## What it is

Feature Engineering in Unity Catalog stores reusable model inputs — **feature tables** — as ordinary Delta tables that carry a primary key, plus a Python client, `FeatureEngineeringClient`, that knows how to join those tables correctly when it builds a training set or looks up features at inference time. A feature table is often built one layer above a gold table from your [[medallion-architecture]], aggregated to the grain a model needs (one row per customer, per session, per device).

## Why it exists

The problem it solves is **training/serving skew**: the moment the code that computes "average order value over the last 30 days" for training diverges even slightly from the code that computes it for a live prediction, the model sees different numbers in production than it did during evaluation, and its accuracy quietly degrades in a way that's hard to trace. Centralizing the feature definition in one table, computed by one pipeline, removes the second implementation entirely — training and serving read the same values.

## How it works

### Feature tables

You create a feature table with `FeatureEngineeringClient().create_table(name=..., primary_keys=..., df=..., description=...)`, naming it with the usual three-level Unity Catalog identifier. From then on it's governed like any other table: [[privileges-grant-revoke]] applies, and `write_table(..., mode="merge")` keeps it current as a scheduled job, much like the streaming or batch jobs behind a [[gold-layer-objects]] table.

### FeatureLookup and point-in-time training sets

To assemble a training set, you don't join the feature table yourself — you describe the join with `FeatureLookup(table_name=..., lookup_key="customer_id", feature_names=[...], timestamp_lookup_key="event_ts")` and pass a list of these to `fe.create_training_set(df=labels_df, feature_lookups=[...], label="churned")`. When a `timestamp_lookup_key` is set, the join is **point-in-time**: for each label row, it pulls the feature values as they existed at that row's timestamp, not the latest ones. This is what prevents label leakage from features that only became true after the fact.

### Serving: batch and online

For batch scoring, `fe.score_batch(model_uri=..., df=...)` re-runs the same lookups against the latest feature values. For real-time scoring behind a [[model-serving-endpoints|serving endpoint]], the feature table is published to an **Online Feature Store**, a low-latency copy the endpoint reads by primary key on every request, so the caller does not have to supply the features.

The online side is now backed by Lakebase. You create the store with `fe.create_online_store(...)`, which provisions a Lakebase Autoscaling project, then `fe.publish_table(...)` keeps it fed in one of three modes: `TRIGGERED`, the default, which syncs incrementally on demand or on a schedule; `CONTINUOUS`, which runs a streaming pipeline for near-immediate updates; and `SNAPSHOT`, a one-off full copy. Older material calls this an online table, which was the previous name.

## Example

```python
from databricks.feature_engineering import FeatureEngineeringClient, FeatureLookup

fe = FeatureEngineeringClient()

fe.create_table(
    name="shop.features.customer_30d",
    primary_keys=["customer_id"],
    df=customer_features_df,
    description="Rolling 30-day order stats per customer",
)

lookups = [
    FeatureLookup(
        table_name="shop.features.customer_30d",
        lookup_key="customer_id",
        feature_names=["orders_30d", "avg_order_value_30d"],
        timestamp_lookup_key="event_ts",
    )
]

training_set = fe.create_training_set(
    df=labels_df,          # customer_id, event_ts, churned
    feature_lookups=lookups,
    label="churned",
    exclude_columns=["event_ts"],
)
training_df = training_set.load_df()
```

A feature table is a Delta table, so it's also queryable directly with plain SQL — useful for spot-checking values without going through the client:

```sql
SELECT customer_id, orders_30d, avg_order_value_30d
FROM shop.features.customer_30d
WHERE customer_id = '12345';
```

## Common mistakes

- Joining the feature table with a plain `DataFrame.join` instead of `FeatureLookup`: you lose the point-in-time semantics and risk leaking future feature values into training.
- Forgetting to publish to an Online Feature Store before wiring the feature table into a serving endpoint, then wondering why lookups fail at request time.
- Choosing `CONTINUOUS` publishing for features that change once a day. It holds a streaming pipeline open to wait for updates that are not coming, and `TRIGGERED` on a schedule costs a fraction of it.
- Recomputing the same aggregation inside two different feature tables because nobody checked whether it already existed — the same "one concept, one place" problem this whole store exists to avoid.
- Treating the feature table as read-only: it needs the same refresh discipline as any other table in a [[medallion-architecture]], or its values go stale.

> [!tip]
> If you can't name the primary key and the refresh schedule of a feature before writing any code, it isn't ready to be a feature table yet — it's still just a query.
