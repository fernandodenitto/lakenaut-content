---
id: model-training-and-tuning
title: Training and tuning a classic model
area: experiments
level: intermediate
summary: Where a model trains on Databricks, the estimator and transformer vocabulary, and the tuning libraries to use now that Hyperopt is gone from the machine learning runtime.
prerequisites: [mlflow-tracking, dataframe-columns-rows]
related: [automl, mlflow-tracking, feature-engineering, models-in-uc, compute-options]
exams:
  - cert: ml-associate
    domain: "Model Development"
    objective: "Choose between single-node and distributed training, use estimators and transformers in a pipeline, and tune hyperparameters with the current libraries."
sources:
  - url: https://docs.databricks.com/aws/en/machine-learning/automl-hyperparam-tuning/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/automl-hyperparam-tuning/optuna
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/train-model/
    checked: 2026-09-12
aliases: [training, hyperparameter tuning, hyperopt, optuna, ray tune, estimator, transformer, spark ml, single node]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

Training a classic model on Databricks is mostly ordinary Python. The machine learning runtime ships scikit-learn, XGBoost, PyTorch and TensorFlow already installed, and a notebook on a single node runs them the way a laptop would, with more memory.

What the platform adds is three things: somewhere to put the experiment record, which is [[mlflow-tracking]]; a way to spread the work when one machine is not enough; and a feature layer so the columns you train on are the same ones the model gets at serving time, which is [[feature-engineering]].

## Why the shape of the decision matters

The instinct on a distributed platform is to distribute everything. For classic machine learning that is usually wrong, and expensive.

Most tabular datasets fit on one large machine. A single node with plenty of memory trains a gradient-boosted model faster than a cluster does, because there is no shuffle and no coordination. Distribution earns its keep in two cases: the data genuinely does not fit, or you are training many models rather than one big one.

That second case is the one people miss. Tuning a hundred hyperparameter combinations is embarrassingly parallel: a hundred small independent jobs, not one large one. Distributing the search while each trial stays on one machine is the pattern that fits most work.

## How it works

### Estimators and transformers

The Spark ML vocabulary is worth knowing because the exam uses it and because the design is sound.

| Thing | What it does | The method |
| --- | --- | --- |
| **Transformer** | turns one DataFrame into another. A tokeniser, a scaler, a trained model producing predictions | `transform()` |
| **Estimator** | learns from a DataFrame and produces a transformer | `fit()` |
| **Pipeline** | a sequence of the two, itself an estimator | `fit()` then `transform()` |

The consequence that matters: a fitted pipeline is one object holding every step, so the preparation that happened at training happens identically at scoring. Half of all training-and-serving skew comes from teams that reimplement the preparation on the serving side.

### Tuning, and the library that went away

> [!changed]
> **Hyperopt is finished.** The open-source project is no longer maintained, and it is not included in Databricks Runtime for Machine Learning after **16.4 LTS**. A great deal of Databricks training material, including exam preparation written before 2026, teaches `fmin` and `SparkTrials`. That code will not run on a current runtime.

What to use instead, per the documentation:

- **Optuna** for single-node optimisation. Light-weight, a dynamic search space, and it works naturally with a per-trial MLflow run.
- **Ray Tune** for distributed tuning, using Ray as the backend.

The mental model stays the same: define a search space, define an objective that returns a metric, let the library propose trials. Only the import changes.

### Keeping the record

Every trial should be an MLflow run, with the parameters, the metric and the model. That is not bookkeeping for its own sake: it is how you answer "why did we choose this" three months later, and it is what [[automl]] produces for free, which is one reason to run AutoML first even when you intend to build the model by hand.

## Example: a tuned model, recorded properly

```python
import mlflow, optuna
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import cross_val_score

X, y = train_df.drop("churned", axis=1), train_df["churned"]

def objective(trial):
    params = {
        "n_estimators": trial.suggest_int("n_estimators", 100, 600),
        "max_depth": trial.suggest_int("max_depth", 2, 8),
        "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
    }
    # One MLflow run per trial, so the search itself is the experiment record.
    with mlflow.start_run(nested=True):
        mlflow.log_params(params)
        score = cross_val_score(GradientBoostingClassifier(**params), X, y, cv=5, scoring="roc_auc").mean()
        mlflow.log_metric("roc_auc", score)
    return score

with mlflow.start_run(run_name="churn-tuning"):
    study = optuna.create_study(direction="maximize")
    study.optimize(objective, n_trials=50)
    mlflow.log_params(study.best_params)
    mlflow.log_metric("best_roc_auc", study.best_value)
```

Fifty trials, one parent run, fifty nested ones, and a leaderboard you can sort in the experiment UI. Register the winner in [[models-in-uc|Unity Catalog]] and it carries its lineage back to this run.

## Common mistakes

- **Using Hyperopt because a tutorial said so.** It is not in the runtime after 16.4 LTS. Optuna or Ray Tune.
- **Distributing a dataset that fits in memory.** The shuffle costs more than the parallelism saves. Size the machine before you size the cluster.
- **Reimplementing preparation at serving time.** Fit a pipeline, log the pipeline, serve the pipeline.
- **Tuning before checking the baseline.** If a trivial model gets within a point of your tuned one, the problem is the features, not the hyperparameters.
- **One run for the whole search.** Fifty trials in one run is fifty results you cannot compare. Nest them.

> [!exam]
> The Machine Learning Associate guide asks about estimators against transformers, about choosing an algorithm, and about mitigating imbalanced training data. Know that an estimator has `fit()` and produces a transformer, that a transformer has `transform()`, and that a pipeline is an estimator made of both. Be aware that the guide predates the removal of Hyperopt, so a question may still name it while the current answer on a recent runtime is Optuna or Ray Tune.
