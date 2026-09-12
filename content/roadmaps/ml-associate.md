---
id: ml-associate
title: Machine Learning Associate
short: ML Associate
exam_guide_version: "2025-03"
exam_guide_url: https://www.databricks.com/sites/default/files/2025-02/databricks-certified-machine-learning-associate-exam-guide-1-mar-2025.pdf
exam_page_url: https://www.databricks.com/learn/certification/machine-learning-associate
questions: 48
minutes: 90
summary: The associate-level certification for using Databricks to perform core machine learning tasks, from feature engineering and AutoML to MLflow tracking, model registration in Unity Catalog, and endpoint deployment.
prerequisite_tracks: [foundations-sql, foundations-python]
full_resources: []
domains:
  - name: "Databricks Machine Learning"
    objectives:
      - "Identify the best practices of an MLOps strategy"
      - "Identify the advantages of using ML runtimes"
      - "Identify how AutoML facilitates model and feature selection"
      - "Identify the advantages AutoML brings to the model development process"
      - "Identify the benefits of creating feature store tables at the account level in Unity Catalog versus the workspace level"
      - "Create a feature store table in Unity Catalog"
      - "Write data to a feature store table"
      - "Train a model with features from a feature store table"
      - "Score a model using features from a feature store table"
      - "Describe the differences between online and offline feature tables"
      - "Identify the best run using the MLflow Client API"
      - "Manually log metrics, artifacts, and models in an MLflow run"
      - "Identify information available in the MLflow UI"
      - "Register a model using the MLflow Client API in the Unity Catalog registry"
      - "Identify benefits of registering models in the Unity Catalog registry over the workspace registry"
      - "Identify scenarios where promoting code is preferred over promoting models, and vice versa"
      - "Set or remove a tag for a model"
      - "Promote a challenger model to a champion model using aliases"
    concepts: [feature-engineering, mlflow-tracking, models-in-uc, automl, training-sets-and-point-in-time, online-feature-store]
  - name: "Data Processing"
    objectives:
      - "Compute summary statistics on a Spark DataFrame using .summary() or dbutils data summaries"
      - "Remove outliers from a Spark DataFrame based on standard deviation or IQR"
      - "Create visualizations for categorical or continuous features"
      - "Compare two categorical or two continuous features using the appropriate method"
      - "Compare and contrast imputing missing values with the mean, median, or mode value"
      - "Impute missing values with the mode, mean, or median value"
      - "Use one-hot encoding for categorical features"
      - "Identify the model types or data sets for which one-hot encoding is or is not appropriate"
      - "Identify scenarios where log scale transformation is appropriate"
    concepts: [dataframe-dedup-aggregations, dataframe-columns-rows]
  - name: "Model Development"
    objectives:
      - "Use ML foundations to select the appropriate algorithm for a given model scenario"
      - "Identify methods to mitigate data imbalance in training data"
      - "Compare estimators and transformers"
      - "Develop a training pipeline"
      - "Use Hyperopt's fmin operation to tune a model's hyperparameters"
      - "Perform random, grid, or Bayesian search as a method for tuning hyperparameters"
      - "Parallelize single-node models for hyperparameter tuning"
      - "Describe the benefits and downsides of cross-validation over a train-validation split"
      - "Perform cross-validation as part of model fitting"
      - "Identify the number of models trained in conjunction with a grid-search and cross-validation process"
      - "Use common classification metrics: F1, log loss, ROC/AUC, etc."
      - "Use common regression metrics: RMSE, MAE, R-squared, etc."
      - "Choose the most appropriate metric for a given scenario objective"
      - "Identify the need to exponentiate log-transformed variables before calculating evaluation metrics or interpreting predictions"
      - "Assess the impact of model complexity and the bias-variance tradeoff on model performance"
    concepts: [model-training-and-tuning, automl, feature-engineering]
  - name: "Model Deployment"
    objectives:
      - "Identify the differences and advantages of model serving approaches: batch, realtime, and streaming"
      - "Deploy a custom model to a model endpoint"
      - "Use pandas to perform batch inference"
      - "Identify how streaming inference is performed with Delta Live Tables"
      - "Deploy and query a model for realtime inference"
      - "Split data between endpoints for realtime inference"
    concepts: [model-serving-endpoints, pipelines-overview, serving-compute-and-scaling]
---

## How to use this roadmap

The four domains follow the order of the official exam guide (live as of March 1, 2025). This version does not publish a percentage weight per section, so treat every domain as equally likely and use the number of objectives, not a published weight, as a rough guide to depth.

What makes this exam different from the data engineering tracks: it is scoped to a single machine learning workflow, run mostly through scikit-learn, SparkML, and MLflow, with SQL used only for general data manipulation, not for the ML-specific tasks. Model Development is the domain with the least coverage in this vault today: hyperparameter tuning with Hyperopt, cross-validation, and classification and regression metrics are exam topics without a concept page yet, so pair this roadmap with the official self-paced courses for that section.

> [!exam]
> No domain weights are published for this exam guide version. Most questions describe a small scenario — a dataset, a metric, a deployment need — and ask you to pick the Databricks-native tool for it, so know the feature store, MLflow, and model serving APIs by name.
