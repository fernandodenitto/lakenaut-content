---
id: mlflow-tracking
title: MLflow tracking on Databricks
area: experiments
level: beginner
summary: MLflow tracking records the parameters, metrics, and artifacts of every training run so you can compare runs and reproduce the best one.
prerequisites: [platform-architecture, dataframe-columns-rows]
related: [feature-engineering, models-in-uc, model-serving-endpoints, runs-monitoring]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/mlflow/tracking
    checked: 2026-09-10
aliases: [mlflow, experiment tracking, autologging, tracking server, logged models]
updated: 2026-09-10
status: published
---

## What it is

MLflow Tracking is the piece of MLflow that records what happened during a training run: which parameters you used, which metrics came out, and which files it produced (model weights, plots, a `requirements.txt`). Every run belongs to an **experiment**, a named container you compare runs within. On Databricks, experiments live as objects in the workspace, so they inherit the same folders and permissions as notebooks.

## Why it exists

Training a model is trial and error: change a hyperparameter, rerun, read the metric, change something else. Without a system to log to, you either keep a spreadsheet by hand or lose track of which combination produced the model you actually liked. Tracking turns every run into a row you can sort, filter, and diff, and it is the audit trail that a model version in [[models-in-uc]] points back to.

## How it works

### Experiments and runs

An experiment is created the first time you log to it, or explicitly with `mlflow.set_experiment("/Users/you/churn-model")`. A **run** is one execution: `with mlflow.start_run():` opens it, code inside the block logs to it, and it closes when the block exits.

### Autologging

`mlflow.autolog()` — or a flavor-specific version such as `mlflow.sklearn.autolog()` or `mlflow.pytorch.autolog()` — patches the training library so that calling `.fit()` logs parameters, metrics, and the model itself automatically. It is on by default in many Databricks ML runtime notebooks and is the fastest way to get a usable history.

### Params, metrics, artifacts

Manual logging uses three calls: `mlflow.log_param(key, value)` for a training-time setting, `mlflow.log_metric(key, value, step=...)` for a number that can change over the run (loss per epoch), and `mlflow.log_artifact(path)` for a file. A metric logged with `step` draws a chart on the run page instead of showing a single value.

### Comparing runs

The experiment page lists every run as a table row, sortable by any metric; select several and click **Compare** for scatter plots and a parallel-coordinates view. The same data is available programmatically through `mlflow.search_runs(experiment_ids=[...])`, which returns a pandas DataFrame.

### Nested runs

`with mlflow.start_run(nested=True):` opened inside an already-active run creates a child run, shown indented under its parent. This fits hyperparameter search naturally: one parent run for the search, one nested run per trial.

### MLflow 3 and models from runs

Since MLflow 3, a **LoggedModel** is a first-class entity rather than just a folder of artifacts attached to a run. `mlflow.<flavor>.log_model(...)` still executes inside a run, but the resulting model gets its own identity, its own metrics (you can attach an evaluation metric to it after the training run ends), and explicit lineage to the run and dataset that produced it. That LoggedModel is what gets registered as a version in [[models-in-uc]].

### Where the tracking server lives

The tracking server on Databricks is managed: `mlflow.set_tracking_uri("databricks")`, the default inside a notebook or job, writes to the workspace's own store with nothing to run or configure. It is the same store whether you log from a notebook, a job, or Databricks Connect from a laptop.

## Example

```python
import mlflow
from sklearn.ensemble import RandomForestRegressor

mlflow.set_experiment("/Users/you/churn-model")
mlflow.autolog()

with mlflow.start_run(run_name="rf-search"):
    for n_estimators in (100, 200, 400):
        with mlflow.start_run(run_name=f"n={n_estimators}", nested=True):
            model = RandomForestRegressor(n_estimators=n_estimators).fit(X_train, y_train)
            mlflow.log_metric("val_rmse", rmse(model, X_val, y_val))

best_runs = mlflow.search_runs(order_by=["metrics.val_rmse ASC"], max_results=1)
```

## Common mistakes

- Turning off autologging and forgetting to log the model itself: the run ends up with metrics but nothing to register in [[models-in-uc]].
- Logging a metric that changes over time without `step`: it overwrites itself instead of drawing a curve.
- Keeping one giant experiment forever, with thousands of unrelated runs in it, instead of one experiment per problem you're actively iterating on.
- Starting a run without `nested=True` inside another open run: MLflow either errors or silently attributes the logs to the wrong run.

> [!tip]
> `mlflow.autolog()` covers almost any first pass at a training job. Reach for manual `log_param`/`log_metric`/`log_artifact` only for values autologging doesn't know about, such as a business metric computed after prediction.
