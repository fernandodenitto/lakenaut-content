---
id: machine-learning
title: "Machine Learning"
tag: "models"
level: intermediate
hours: 50
order: 6
icon: flask-conical
summary: "Track experiments with MLflow, build features, register models in Unity Catalog and serve them behind an endpoint."
certs: []
stages:
  - name: "Foundations"
    concepts: [platform-architecture, dataframe-columns-rows]
  - name: "Experiment"
    concepts: [mlflow-tracking, feature-engineering, mlflow-tracing, automl, model-training-and-tuning, mlflow-3-models, ai-runtime, training-sets-and-point-in-time, feature-views]
  - name: "Register and serve"
    concepts: [models-in-uc, model-serving-endpoints, serving-compute-and-scaling, online-feature-store, mlflow-deployment-jobs, model-monitoring]
---

Everything here assumes the data is already governed and clean, so do [[lakehouse-foundations|Lakehouse Foundations]] first if that is not true yet.

The order matters: tracking gives you something to compare, features give you something reproducible, the registry gives you something to promote, and serving gives you something to call. Skipping to serving is how models end up unversioned in a notebook.
