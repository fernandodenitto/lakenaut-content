---
id: mlflow-3-models
title: MLflow 3 for models
area: experiments
level: intermediate
summary: MLflow 3 makes the model a first-class object with its own id, metrics and artifacts, defaults the registry to Unity Catalog, and renames enough of the API to break MLflow 2 code.
prerequisites: [mlflow-tracking]
related: [models-in-uc, mlflow-tracing, agent-evaluation, model-serving-endpoints, automl]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/mlflow/mlflow-3-install
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/mlflow/logged-model
    checked: 2026-09-12
  - url: https://mlflow.org/docs/latest/ml/mlflow-3/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/agent-eval-migration-reference
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/release-notes/runtime/17.3lts-ml
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/prompt-version-mgmt/prompt-registry/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/prompt-version-mgmt/prompt-registry/automatically-optimize-prompts
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/human-feedback/expert-feedback/label-existing-traces
    checked: 2026-09-12
aliases: [mlflow 3, logged model, loggedmodel, model_id, artifact_path, mlflow migration, databricks-uc, mlflow.models.evaluate]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

MLflow 3 is the version of MLflow that the current Databricks machine learning and generative AI tooling is built on. Experiments and runs still mean what they always meant (see [[mlflow-tracking]]), but the thing you actually care about has been promoted: a **LoggedModel** is now an entity in its own right, with a `model_id`, its own parameters and metrics, its own artifact location, and explicit links back to the runs and datasets it is connected to.

That one promotion changes small things everywhere. A model URI no longer contains a run id. Model files no longer sit under the run's artifacts. The registry defaults to Unity Catalog, so a model name has three levels. And a set of functions and arguments were renamed, which is what makes a straight copy of an MLflow 2 notebook fail rather than merely warn.

## Why it exists

In MLflow 2 the run was the unit of record, and a model was a folder of files hanging off one. That held together as long as a run trained exactly one model and you scored it before the run closed. Three situations broke it.

Deep learning produces many checkpoints inside a single run, and every one of them is a candidate model with its own quality. Evaluation usually happens later, in a separate run, so the number that decides whether to ship was recorded against the evaluation run instead of against the model it described, and reuniting the two was manual. And a generative AI application has no training run at all, yet it still needs a versioned artefact to evaluate, trace and deploy.

Promoting the model solves all three at once: metrics, parameters, traces and evaluation results attach to a `model_id` that outlives any single run.

## How it works

### The LoggedModel

`mlflow.<flavor>.log_model()` returns a `model_info` object carrying `model_id` and `model_uri`, and MLflow no longer requires an active run for it. From the id you get:

- `mlflow.get_logged_model(model_id)` to fetch the entity;
- `mlflow.log_metrics(metrics={...}, model_id=..., dataset=...)` to attach numbers to the model after training has finished, optionally tied to the dataset they were computed on;
- `mlflow.search_logged_models(filter_string=...)` to search across `model_id`, `model_name`, `status`, `artifact_uri`, `creation_time` and `last_updated_time`, as well as `params.*`, `metrics.*` and `tags.*`.

The link runs in both directions: `mlflow.search_runs(filter_string="models.model_id = <id>")` returns every run that had that model as an input or an output.

### What moved

| MLflow 2 | MLflow 3 |
| --- | --- |
| `log_model(artifact_path="model", ...)` | `log_model(name="model", ...)`, so the model can be searched by name |
| `runs:/<run_id>/<artifact_path>` | `models:/<model_id>`, or the `model_uri` that `log_model` hands back |
| `experiments/<experiment_id>/<run_id>/artifacts/` | `experiments/<experiment_id>/models/<model_id>/artifacts/` |
| `mlflow.evaluate()` | `mlflow.models.evaluate()` for classic models, `mlflow.genai.evaluate()` for generative AI |
| `extra_metrics=[...]`, `@metric` | `scorers=[...]`, `@scorer` |
| `model=my_agent`, `model_type="databricks-agent"` | `predict_fn=my_agent`, no model type |
| `higher_is_better` | `greater_is_better` |
| workspace model registry | `databricks-uc`, the default |

`artifact_path` is still accepted and deprecated. `baseline_model` and `custom_metrics` are gone from the evaluation call: validation moved to `mlflow.validate_evaluation_results()`. MLflow Recipes and the `fastai`, `mleap`, `diviner` and `gluon` flavours were removed outright.

Generative AI code moves further than classic code, because the old `databricks-agents` evaluation surface was folded into MLflow. `databricks.agents.evals.metric` becomes `mlflow.genai.scorers.scorer`, `databricks.agents.evals.judges` becomes `mlflow.genai.judges`, and `databricks.agents.review_app` becomes `mlflow.genai.labeling`. The data columns were renamed with them: `request` is `inputs`, `response` is `outputs`, `expected_response` is one key inside `expectations`, and `retrieved_context` is no longer a column at all because a scorer reads it from the trace (see [[mlflow-tracing]] and [[agent-evaluation]]).

### Unity Catalog is the default registry

The registry URI defaults to `databricks-uc`, so registering a model means a three-level `catalog.schema.model` name and grants instead of workspace ACLs. That is [[models-in-uc]], and it is the reason a LoggedModel and a registered model version are two different objects: the LoggedModel is the thing you trained, the version is the thing you promoted.

### It is not preinstalled

Databricks Runtime for Machine Learning ships `mlflow-skinny`, not the full package with the Databricks extras: Databricks Runtime 17.3 LTS ML carries `mlflow-skinny` 3.0.1. The documented way in is a pip magic and a Python restart at the top of the notebook, repeated in every session because the install does not survive it:

```python
%pip install mlflow>=3.0 --upgrade
dbutils.library.restartPython()
```

`>=3.0` is only the floor for the model APIs. Several features need a newer client than that, and pinning too low fails at import or at the first call rather than at install:

| Feature | Floor |
| --- | --- |
| LoggedModel and the model APIs | `mlflow>=3.0` |
| Prompt registry and evaluating prompt versions | `mlflow[databricks]>=3.1.0` |
| End-user feedback logged from an application | `mlflow[databricks]>=3.1`, or `mlflow-tracing` in production |
| `mlflow.genai.optimize_prompts()` | `mlflow>=3.5.0` |
| Labelling existing traces | `mlflow>=3.14.0` with `databricks-connect>=16.1` |
| Traces stored in Unity Catalog | `mlflow[databricks]>=3.14` |

### What did not change

Experiments, runs, nesting, autologging and `mlflow.search_runs()` behave as before. One exception worth knowing: Spark model logging still works but does not produce a LoggedModel, so the new metrics-on-a-model workflow does not apply to it.

## Example: score a model in a later run than the one that trained it

```python
%pip install mlflow>=3.0 --upgrade
dbutils.library.restartPython()
```

```python
import mlflow
from sklearn.linear_model import ElasticNet
from sklearn.metrics import mean_squared_error, r2_score

mlflow.set_registry_uri("databricks-uc")
mlflow.set_experiment("/Users/you/house-prices")

with mlflow.start_run(run_name="train"):
    model = ElasticNet(alpha=0.5, l1_ratio=0.5).fit(train_x, train_y)
    info = mlflow.sklearn.log_model(
        sk_model=model,
        name="elasticnet",          # not artifact_path
        params={"alpha": 0.5, "l1_ratio": 0.5},
        input_example=train_x.head(),
    )

model_id = info.model_id  # survives the run: this is what you carry forward

# A separate run, possibly a separate job, on a holdout set
with mlflow.start_run(run_name="evaluate"):
    preds = mlflow.pyfunc.load_model(f"models:/{model_id}").predict(test_x)
    mlflow.log_metrics(
        metrics={"rmse": mean_squared_error(test_y, preds) ** 0.5, "r2": r2_score(test_y, preds)},
        model_id=model_id,          # the metric lands on the model, not on this run
    )

best = mlflow.search_logged_models(filter_string="metrics.rmse < 0.8", order_by=[{"field_name": "metrics.rmse"}])
mlflow.register_model(f"models:/{model_id}", "main.ml.house_prices")
```

The evaluation run is a bookkeeping detail here. What you compare, search and register is the model, and `search_logged_models` can rank candidates by a metric that was computed hours after they were trained.

## Common mistakes

- **Keeping `runs:/<run_id>/model` URIs in production code.** They are deprecated, and after migration the file is not under the run's artifacts any more. Use the `model_uri` that `log_model` returns, or `models:/<model_id>`.
- **Debugging with `list_artifacts()` on the run.** Model files moved to `experiments/<experiment_id>/models/<model_id>/artifacts/`, so the run looks empty even though the model logged correctly.
- **Running the pip install once and assuming the cluster keeps it.** The install and `dbutils.library.restartPython()` belong at the top of every notebook that needs MLflow 3, and a job that skips them gets whatever the runtime shipped.
- **Passing MLflow 2 evaluation arguments.** `extra_metrics`, `model=`, `model_type="databricks-agent"` and `custom_metrics` are not accepted by `mlflow.genai.evaluate()`, and a `@metric` function is not a `@scorer`.
- **Using a two-level model name.** With `databricks-uc` as the default registry, `ml.house_prices` is not a name, it is an error. Registered models need `catalog.schema.model`.
- **Assuming one floor covers everything.** `mlflow>=3.0` gets you models and nothing else; the prompt registry, prompt optimisation and Unity Catalog traces each need a newer client.

> [!tip]
> Migrating a working MLflow 2 notebook is usually four edits: `artifact_path` to `name`, any hard-coded `runs:/` URI to the returned `model_uri`, `mlflow.evaluate` to `mlflow.models.evaluate` or `mlflow.genai.evaluate`, and the model name to three levels. Do them together, because the failures they cause look unrelated to each other.
