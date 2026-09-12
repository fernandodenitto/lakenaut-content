---
id: models-in-uc
title: Models in Unity Catalog
area: models
level: intermediate
summary: Models in Unity Catalog register a trained model under a three-level name and mark its deployment status with aliases instead of stages.
prerequisites: [unity-catalog-overview, mlflow-tracking]
related: [feature-engineering, model-serving-endpoints, privileges-grant-revoke, managed-vs-external-tables]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/machine-learning/manage-model-lifecycle/
    checked: 2026-09-10
aliases: [model registry, UC model registry, registered model, model aliases, champion challenger]
updated: 2026-09-12
status: published
---

## What it is

Models in Unity Catalog is the model registry built into Unity Catalog: a trained model, logged during an MLflow run (see [[mlflow-tracking]]), gets registered under a three-level name — `catalog.schema.model` — exactly like a table. Each time you register against that name, MLflow creates a new, immutable **version**, carrying forward the parameters, metrics, and lineage of the run it came from.

## Why it exists

Before this, a model registry lived in the workspace, disconnected from the catalog that governs the tables the model was trained on and the tables it will score. Putting the registry inside Unity Catalog means one permission model, one lineage graph, and one three-level namespace cover data and models together, and a model can be shared or promoted across workspaces the same way a table can.

## How it works

### Versions and aliases

Every registration bumps the version number; nothing is ever overwritten. What changes over time is which version is "the one in production." Older registries used fixed **stages** (`Staging`, `Production`, `Archived`) for that; Unity Catalog replaces them with **aliases** — named, mutable pointers you assign to any version, most commonly `@champion` for what's live and `@challenger` for what's being evaluated against it:

```python
from mlflow import MlflowClient

client = MlflowClient()
client.set_registered_model_alias("shop.ml.churn_model", "champion", version=7)
client.set_registered_model_alias("shop.ml.churn_model", "challenger", version=8)
```

An alias can point to only one version at a time, but a version can hold several aliases, and moving `@champion` to a new version is a metadata update — no redeploy of the training code.

### Permissions and lineage

A registered model is a securable object, governed the same way as any other in [[privileges-grant-revoke]]: registering requires `CREATE MODEL` on the schema, and every consumer needs `EXECUTE` on the model itself. Because the model version's lineage carries the tables it was trained on (logged as an MLflow input) and, once served, the queries made against it, the model version's page shows a full lineage graph — the same kind of graph a table gets from `[[unity-catalog-overview|lineage]]` tracking.

### Promoting across workspaces

A model registered in a dev workspace can be copied into a prod workspace's catalog with `client.copy_model_version(src_model_uri, dst_name)`, which creates a new version in the destination pointing at the same underlying artifacts. Aliases are workspace-local, so you reassign `@champion` in the destination catalog after the copy — promotion is "copy the version, then move the alias," not a single one-step publish.

### Loading by alias

Downstream code never hardcodes a version number; it loads `models:/<catalog>.<schema>.<model>@<alias>`, so swapping which version is live doesn't require touching the caller:

```python
import mlflow

model = mlflow.pyfunc.load_model("models:/shop.ml.churn_model@champion")
predictions = model.predict(batch_df)
```

## Example

```python
import mlflow

mlflow.set_registry_uri("databricks-uc")

with mlflow.start_run():
    mlflow.sklearn.log_model(
        sk_model=trained_model,
        name="model",
        registered_model_name="shop.ml.churn_model",
    )
```

```sql
-- grant a downstream team read access to the model, UC-style
GRANT EXECUTE ON MODEL shop.ml.churn_model TO `data-science-team`;
```

## Common mistakes

- Still thinking in stages: there is no `Production` stage to transition into — you assign `@champion` (or whatever alias your team standardizes on) to a version.
- Forgetting that aliases don't travel with `copy_model_version`: the copy lands with no alias until you set one in the destination workspace.
- Granting `EXECUTE` on the catalog or schema instead of the model, which is broader than intended — see [[privileges-grant-revoke]] for how the grant hierarchy actually resolves.
- Loading a model by a hardcoded version number in application code, which then requires a code change every time you promote a new one.

> [!tip]
> Standardize on a small, fixed set of alias names (`champion`, `challenger`) across every model in the catalog. Alias names are free text, and a different naming scheme per team turns "which version is live?" back into a manual lookup.
