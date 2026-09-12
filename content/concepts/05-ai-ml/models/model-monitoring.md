---
id: model-monitoring
title: Monitoring a deployed model
area: models
level: advanced
summary: Attaching a data profile to a model's inference table, so prediction quality, drift and fairness become Delta tables you can query and alert on.
prerequisites: [model-serving-endpoints, data-quality-monitoring]
related: [data-quality-monitoring, model-serving-endpoints, models-in-uc, alerts-overview, training-sets-and-point-in-time]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-quality-monitoring/data-profiling/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-quality-monitoring/data-profiling/create-monitor-api
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-quality-monitoring/data-profiling/monitor-output
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-quality-monitoring/data-profiling/custom-metrics
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-quality-monitoring/data-profiling/fairness-bias
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-quality-monitoring/data-profiling/monitor-dashboard
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-quality-monitoring/data-profiling/monitor-alerts
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/model-serving/inference-tables
    checked: 2026-09-12
aliases: [model monitoring, inference profile, InferenceLog, lakehouse monitoring, inference table, model drift, prediction drift, fairness and bias, predictive parity, custom metrics, model quality metrics]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

Monitoring a deployed model on Databricks is not a separate product. It is the same **data profiling** feature that watches tables, described in [[data-quality-monitoring]], pointed at a table whose rows happen to be model requests. You choose the `InferenceLog` analysis type instead of `TimeSeries` or `Snapshot`, tell it which column holds the prediction and which holds the label, and it computes model quality and drift metrics per time window and per model version on top of the ordinary column statistics.

This is the feature that used to be called **Lakehouse Monitoring**, and material written before the rename describes exactly this mechanism under that name. The output is the same as for a table: two Delta tables in Unity Catalog, `{output_schema}.{table_name}_profile_metrics` and `{output_schema}.{table_name}_drift_metrics`, plus a generated dashboard.

## Why it exists

A model in production degrades without failing. Latency stays flat, the endpoint returns 200, and the predictions get worse, because the population moved: a new marketing channel changed who signs up, a currency changed scale, a category was renamed upstream. Nothing in the serving stack notices, because nothing in the serving stack knows what a good prediction looks like.

Two separate signals catch this, and an inference profile computes both. **Input drift** compares the distributions arriving now against the previous window, or against the data the model was trained on, and needs no labels at all, which is what makes it useful on day one. **Model quality** compares predictions against ground truth once the truth arrives, often weeks later, and answers the question drift can only hint at.

Keeping this inside the table-profiling feature rather than a separate ML monitoring service is the point: the metrics are tables, so an alert on accuracy is a SQL alert and retention and permissions are Unity Catalog's problem rather than yours.

## How it works

### Getting the inference table

A [[model-serving-endpoints|serving endpoint]] with request logging enabled writes every request and response to a Delta table named `<catalog>.<schema>.<endpoint-name>_payload`. For custom models, foundation models and agent endpoints the recommended route is now AI Gateway-enabled inference tables rather than the legacy `auto_capture_config`.

That table is not yet profilable. Its columns are `databricks_request_id`, `client_request_id`, `date`, `timestamp_ms`, `status_code`, `execution_time_ms`, `sampling_fraction`, `request_metadata`, and then `request` and `response` as raw JSON strings. An inference profile needs one column per model input, one prediction column and a timestamp, so there is an unpacking step between the endpoint and the monitor: parse the JSON into columns, join the labels in when they arrive, and profile that table. Two properties of the log shape that job. Rows appear within an hour of the request, not instantly, and delivery is at-least-once, so the unpacking should deduplicate on `databricks_request_id`.

### Configuring the profile

The current SDK is `databricks-sdk` 0.68.0 or above, and the calls live under `w.data_quality`. An `InferenceLogConfig` needs:

| Field | What it is |
| --- | --- |
| `problem_type` | `INFERENCE_PROBLEM_TYPE_CLASSIFICATION` or `INFERENCE_PROBLEM_TYPE_REGRESSION` |
| `prediction_column` | the model's predicted value |
| `timestamp_column` | when the request happened |
| `model_id_column` | which model version served it, as registered in Unity Catalog |
| `granularities` | the window sizes, from `AGGREGATION_GRANULARITY_5_MINUTES` up to `AGGREGATION_GRANULARITY_1_YEAR` |
| `label_column` | optional ground truth; model quality metrics are only computed when both this and `prediction_column` are present |

The surrounding `DataProfilingConfig` carries `output_schema_id`, `assets_dir`, `slicing_exprs`, an optional baseline table, a `CronSchedule` and `notification_settings`. Slices are created automatically for each distinct value of the model id column, which is what makes "is the challenger version better than the champion" a query over one table rather than a separate experiment; the versions and aliases themselves come from [[models-in-uc]].

For an inference profile the right baseline is the data the model was trained or validated on, carrying the same feature columns and the same model id column. Drift against the previous window says something moved; drift against that baseline says the live population has left the one the model learned from, which is the retraining signal.

### What lands in the metric tables

Rows are grouped by `window`, `granularity`, `log_type` (`INPUT` or `BASELINE`), `slice_key`, `slice_value`, `model_id_col` and `column_name`. Metrics that span columns, model quality among them, use the special `column_name` value `:table`.

Per column you get the usual statistics, `count` through `percent_null` and `frequent_items`, as on any profiled table. Per model you get, for classification, `accuracy_score`, `precision`, `recall`, `f1_score`, `confusion_matrix`, and `log_loss` and `roc_auc_score` when a predicted-probability column is configured; for regression, `mean_squared_error`, `root_mean_squared_error`, `mean_average_error`, `mean_absolute_percentage_error` and `r2_score`.

The drift table adds `window_cmp` and `drift_type`, which is `CONSECUTIVE` for the previous window or `BASELINE` for the baseline table. Numeric columns get `ks_test`, `wasserstein_distance` and `population_stability_index`; categorical columns get `chi_squared_test`, `tv_distance`, `l_infinity_distance` and `js_distance`; everything gets the deltas, `count_delta`, `avg_delta`, `percent_null_delta` and the rest.

### Custom metrics

Anything the built-in list misses you add as a `MonitorMetric`, in one of three kinds: `CUSTOM_METRIC_TYPE_AGGREGATE`, computed from the table's columns; `CUSTOM_METRIC_TYPE_DERIVED`, computed from aggregates already calculated; and `CUSTOM_METRIC_TYPE_DRIFT`, comparing an earlier metric across two windows or against the baseline. Each one is a `name`, a list of `input_columns`, a `definition` holding a Jinja template around a SQL expression, and an `output_data_type` as a Spark type in JSON. Use `[":table"]` as the input columns when the metric spans the table, which is the case for most model-level metrics.

This is where a business metric belongs. Accuracy is rarely what anyone is paid to care about; the expected cost of a false positive usually is, and that is an aggregate metric over the prediction and label columns.

### Fairness and bias

For a classification model, a Boolean slicing expression turns on four extra metrics. The group where the expression evaluates to `True` is the protected group, so `slicing_exprs=["age < 25"]` compares under-25s against everyone else:

| Metric | What it compares between the groups |
| --- | --- |
| `predictive_parity` | precision |
| `predictive_equality` | false positive rate |
| `equal_opportunity` | recall |
| `statistical_parity` | rate of being predicted into a given class |

All four are computed one-vs-all across predicted classes and reported as key-value pairs, and the first three need a label column. They only exist when the analysis type is `InferenceLog` and the problem type is classification.

### Dashboard, refresh and alerts

Creating a profile generates a customisable dashboard, reachable from the Quality tab of the table in Catalog Explorer. The two refreshes are separate and neither implies the other: refreshing the profile recomputes the metric tables, refreshing the dashboard re-runs its queries over whatever the tables already hold. Refreshes run on serverless compute rather than on your cluster. Alerting is plain [[alerts-overview|SQL alerts]] over the metric tables.

## Example: profile an unpacked inference table

```python
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.dataquality import (
    AggregationGranularity, DataProfilingConfig, InferenceLogConfig,
    InferenceProblemType, Monitor,
)

w = WorkspaceClient()
schema = w.schemas.get(full_name="shop.monitoring")
table = w.tables.get(full_name="shop.monitoring.churn_requests")

config = DataProfilingConfig(
    output_schema_id=schema.schema_id,
    assets_dir="/Workspace/Users/me@example.com/quality/churn_requests",
    inference_log=InferenceLogConfig(
        problem_type=InferenceProblemType.INFERENCE_PROBLEM_TYPE_CLASSIFICATION,
        prediction_column="prediction",
        label_column="churned",          # joined in later; quality metrics need it
        model_id_column="model_version",
        timestamp_column="request_ts",
        granularities=[AggregationGranularity.AGGREGATION_GRANULARITY_1_DAY],
    ),
    slicing_exprs=["age < 25"],          # Boolean slice turns on fairness metrics
)

w.data_quality.create_monitor(
    monitor=Monitor(
        object_type="table",
        object_id=table.table_id,
        data_profiling_config=config,
    )
)
```

Then the alert is a query, one row per day per model version:

```sql
SELECT window.start AS day, model_version, f1_score
FROM shop.monitoring.churn_requests_profile_metrics
WHERE column_name = ':table'          -- model-level metrics, not per column
  AND slice_key IS NULL               -- the whole population
  AND log_type = 'INPUT'
  AND window.start >= current_date() - INTERVAL 30 DAYS
ORDER BY day DESC;
```

## Common mistakes

- **Pointing the profile straight at the `_payload` table.** `request` and `response` are JSON strings. Until they are unpacked into one column per input and a prediction column, an inference profile has nothing to measure.
- **Waiting for labels before monitoring anything.** Input drift needs no ground truth and is available from the first day. Configure the label column, leave it empty, and backfill it when the truth arrives.
- **Skipping the baseline table.** Without it you only get consecutive drift, which reports that today differs from yesterday. The baseline, the training or validation set, is what tells you the live data has left the distribution the model learned.
- **Assuming the window covers all history.** Time series and inference profiles compute metrics over the last 30 days, and at creation only the preceding 30 days are analysed. Long-run trends accumulate in the metric tables; they cannot be recomputed later.
- **Leaving [[change-data-feed|change data feed]] off on a busy request table.** With the feed on, each refresh processes only newly appended rows instead of rescanning, which is the difference between a cheap monitor and an expensive one.
- **Deciding the slices after creating the profile.** Only one profile can exist per table in a metastore, so the unpacked table's schema and its `slicing_exprs` are the whole design.

> [!tip]
> Two of these metrics change behaviour and two only change a dashboard. Baseline drift on the input columns and model quality against labels are the pair worth wiring to an alert, because each has an obvious response: investigate the upstream change, or retrain. Consecutive drift on every column produces steady noise, so read it when something is already wrong.
