---
id: automl
title: AutoML
area: experiments
level: beginner
summary: Automatic model search over classification, regression and forecasting that hands back a notebook per trial, which is the part that makes it useful rather than magic.
prerequisites: [mlflow-tracking]
related: [mlflow-tracking, feature-engineering, models-in-uc, model-serving-endpoints, compute-options]
exams:
  - cert: ml-associate
    domain: "Databricks Machine Learning"
    objective: "Use AutoML to produce a baseline model and read the generated notebooks."
sources:
  - url: https://docs.databricks.com/aws/en/machine-learning/automl/
    checked: 2026-09-12
aliases: [automl, automated machine learning, baseline model, glass box, trial notebook]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

AutoML takes a table, a target column and a problem type, then trains a lot of models and tells you which did best. It covers **classification**, **regression** and **forecasting**.

The part that separates it from the genre is what you get back. Every trial produces a **source notebook** with the actual code: the preparation, the algorithm, the hyperparameters, the evaluation. Nothing is hidden behind a service. The best model is registered in an MLflow experiment, and you can open the notebook that produced it, change three lines and run it yourself.

## Why it exists

Two audiences, two reasons.

For somebody who does not write models for a living, it answers "is there a signal in this data at all" in an afternoon rather than a fortnight. That question deserves a cheap answer, because the honest reply is often no.

For somebody who does, it is a baseline. Any model you build by hand should beat the automatic one, and being able to say by how much is the difference between a model that ships and a model that argues. It also removes the tedious first day of work: the sensible preprocessing, the obvious algorithms, the first hyperparameter sweep.

## How it works

### What it does for you

Data preparation happens automatically: missing values, categorical encoding, the usual cleaning that everyone writes slightly differently. Then it orchestrates distributed training across several algorithms and tunes hyperparameters, tracking every trial in MLflow so the comparison is a table rather than a memory.

You end with an experiment full of runs, a best model, and a notebook per trial.

### The requirement that trips people

AutoML runs on the machine learning runtime, and the cluster has to be a plain one: **Databricks Runtime for Machine Learning without modified preinstalled libraries**. Pinning a different version of scikit-learn on that cluster is how a run fails for reasons that look nothing like the cause. Ports 1017 and 1021 need to be open.

> [!changed]
> From **Databricks Runtime 18.0 ML** onwards, AutoML is no longer a built-in library. It comes from the `databricks-automl-runtime` package on PyPI instead. Material written before that assumes it is simply there, and on a newer runtime it is not.

### Reading the result properly

The metric AutoML optimises is the one you gave it, and it will optimise it faithfully into a model that is useless in production. Three checks before you believe a leaderboard:

- **Leakage.** A column that encodes the answer produces a beautiful number. The generated notebook shows you which features mattered, which is where leakage becomes visible.
- **The split.** For forecasting, a random split is meaningless. Check what it did with time.
- **The baseline.** Compare against predicting the majority class or last week's value. A model that beats nothing is not a model.

## Example: how to actually use it

Run it on the training table you already have, with a sensible timeout, and let it finish. Then open the notebook behind the best trial and read it, top to bottom. That reading is the deliverable, not the model.

What you take from it: which family of models suits the data, which features carried the signal, and what preprocessing was needed. What you usually rebuild by hand: the feature pipeline, so it can live in [[feature-engineering|the feature store]] and be reused at serving time, and the evaluation, so it measures the thing the business cares about rather than the metric that was convenient.

Then register the model you actually want in [[models-in-uc|Unity Catalog]] and serve it from there.

## Common mistakes

- **Shipping the AutoML model as-is.** It is a baseline and a starting point. It has not seen your deployment constraints, your latency budget or your fairness requirements.
- **Running it on a customised cluster.** The machine learning runtime with untouched libraries is a hard requirement, not a recommendation.
- **Assuming it is still built in.** From 18.0 ML the package has to be installed.
- **Trusting the leaderboard over the notebook.** The metric can be right and the model wrong. The notebook is where you find out.
- **Using it to avoid understanding the data.** It automates the search, not the judgement about what the target should be.

> [!exam]
> The Machine Learning Associate guide names AutoML directly, so know the three problem types it covers, that it produces an editable notebook per trial rather than a black box, and that it runs on the machine learning runtime with unmodified libraries. The distinction worth holding on to is that AutoML produces a baseline to beat, and the registered model still belongs in Unity Catalog like any other.
