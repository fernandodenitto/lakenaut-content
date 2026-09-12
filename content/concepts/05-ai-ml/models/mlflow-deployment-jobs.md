---
id: mlflow-deployment-jobs
title: MLflow deployment jobs
area: models
level: advanced
summary: A deployment job binds a registered model to a Lakeflow job whose evaluation, approval and deployment tasks fire whenever a new model version appears, with a human gate in the middle.
prerequisites: [models-in-uc, jobs-overview]
related: [mlflow-tracking, model-serving-endpoints, jobs-task-dependencies, jobs-repair-runs, privileges-grant-revoke]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/mlflow/deployment-job
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/manage-model-lifecycle/
    checked: 2026-09-12
aliases: [deployment job, deployment_job_id, model approval, approval task, model promotion, mlflow 3 deployment jobs]
updated: 2026-09-12
status: published
maturity: public-preview
maturity_checked: 2026-09-12
---

> [!note]
> Deployment jobs are in Public Preview as of September 2026. They can change without notice and they are not on any exam guide. Read this to know the mechanism exists, not to build a release process on it yet.

## What it is

A **deployment job** is an ordinary Lakeflow job that a registered model in [[models-in-uc]] points at. Register a new version of that model and the job runs, with the version's name and number handed to it as parameters. The conventional shape is three tasks: **evaluation**, which scores the new version, **approval**, which waits for a person, and **deployment**, which puts the approved version behind a [[model-serving-endpoints|serving endpoint]].

The connection is one field on the registered model, `deployment_job_id`. Nothing about the job itself is special: the tasks are notebooks, the compute is serverless, the run history is the same run history as any other job.

## Why it exists

Unity Catalog deliberately dropped the two mechanisms the old workspace registry used for this. There are no **stages** to transition a version through, and there are no **webhooks** to fire when one appears. What replaced them, aliases and tags, is honest about being metadata: `@champion` records a decision, it does not make one.

So the gap between "a model version exists" and "that version is serving traffic" was filled by hand, usually by a nightly job that listed versions, compared them against the alias, and messaged somebody. Every team wrote that job, each one slightly differently, and none of them recorded why a version was approved. A deployment job moves the same three steps into a job you can read, with the approval recorded as a tag on the version rather than as a message in a channel.

## How it works

### The three tasks

| Task | What it does | How it is recognised |
| --- | --- | --- |
| Evaluation | calls `mlflow.evaluate()` on the new version and logs validation metrics | by convention only |
| Approval | fails until a person approves the version | task name starts with `approval`, case-insensitive |
| Deployment | moves the alias and updates the serving endpoint | by convention only |

Only the approval task is special to Databricks. The other two are notebooks you write, and Databricks ships template notebooks for all of them, including one for classic ML evaluation, one for GenAI evaluation, one for the approval check and one that creates the job programmatically.

Two **job-level** parameters are mandatory: `model_name` and `model_version`. Job-level, not task-level, because every task needs them and the trigger populates them.

### Binding the job to the model

From the UI, open the model's **Overview** tab, and under **Deployment job** click **Connect deployment job**, pick the job by name or id, then **Save changes**. Programmatically it is one call on the MLflow client:

```python
from mlflow import MlflowClient

client = MlflowClient(registry_uri="databricks-uc")
client.update_registered_model("main.ml.churn_model", deployment_job_id="<job-id>")

# also available at creation time
client.create_registered_model("main.ml.fraud_model", deployment_job_id="<job-id>")

# disconnect with an empty string, not None
client.update_registered_model("main.ml.churn_model", deployment_job_id="")
```

Connecting requires `MANAGE` or ownership on the model, and the model owner needs **CAN MANAGE RUN** on the job. Existing models can be connected retroactively.

### The trigger, and whose credentials it uses

Once connected, the job is triggered automatically on **any** new version of that model, and this is the part to read twice: the automatic run executes **with the model owner's credentials**. That turns `CREATE MODEL VERSION` into a much stronger privilege than it looks, because a user who holds it can cause code to run as the model owner. Databricks says this plainly: granting that privilege lets the user execute arbitrary code as part of the job.

The mitigation is to set the job's **Run As** principal to a service principal holding the minimum it needs, so the blast radius of a triggered run is that principal's grants rather than a human owner's. Combined with [[privileges-grant-revoke|tight grants]] on `CREATE MODEL VERSION`, that keeps the automation from becoming an escalation path.

### How approval actually works

The approval task is a deliberate failure. On the first run it always fails, because approval is expressed as a Unity Catalog tag on the model version and the tag is not there yet. The tag key is the approval task's own name, for example `Approval_Check`, and the value has to be `Approved`.

A person with `APPLY TAG` on the model and CAN MANAGE RUN on the job then reads the evaluation metrics on the model version page and clicks **Approve** in the deployment job panel. That single click applies the tag and repairs the run, which resumes from the failed approval task and carries on into deployment. There is no Reject button: rejecting a version means not repairing the run, and the model version page keeps the failed run as the record.

### Job settings that matter

Set **max concurrent runs to 1**. Two versions registered a minute apart otherwise race each other into the same endpoint, and the alias ends up wherever the slower run finished. Disable retries on the approval task, because its first failure is by design and a retry loop only burns the run history. Leave retries on the evaluation and deployment tasks where a transient failure is worth retrying.

## Example: evaluate, approve, deploy

The approval task, the only one with non-obvious logic. It reads the tag and fails if it is not there:

```python
from mlflow import MlflowClient

model_name = dbutils.widgets.get("model_name")
model_version = dbutils.widgets.get("model_version")

client = MlflowClient(registry_uri="databricks-uc")
tags = client.get_model_version(model_name, model_version).tags

if tags.get("Approval_Check") != "Approved":
    raise Exception(
        f"{model_name} version {model_version} is not approved. "
        "Review the metrics on the model version page and click Approve."
    )
```

The deployment task, which runs only once the repaired approval task passes:

```python
from mlflow import MlflowClient
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import EndpointCoreConfigInput, ServedEntityInput

model_name = dbutils.widgets.get("model_name")
model_version = dbutils.widgets.get("model_version")

client = MlflowClient(registry_uri="databricks-uc")
client.set_registered_model_alias(model_name, "champion", version=int(model_version))

WorkspaceClient().serving_endpoints.update_config(
    name="churn-scoring",
    served_entities=[
        ServedEntityInput(
            entity_name=model_name,
            entity_version=model_version,
            workload_size="Small",
            scale_to_zero_enabled=True,
        )
    ],
)
```

Registering a version then sets the whole chain off:

```python
import mlflow

mlflow.set_registry_uri("databricks-uc")
mlflow.sklearn.log_model(
    sk_model=trained_model,
    name="model",
    registered_model_name="main.ml.churn_model",  # this line triggers the deployment job
)
```

## Common mistakes

- **Leaving a human owner on a model with a deployment job.** The automatic trigger runs as the model owner, so anyone who can create a version can run code as them. Set Run As to a minimal service principal before you connect the job.
- **Putting `model_name` and `model_version` on the tasks instead of the job.** They have to be job-level parameters; the trigger fills those in and task-level copies never receive the version.
- **Filing a bug about the first run failing.** The approval task is meant to fail until the version carries the tag. That failure is the gate.
- **Retrying the approval task.** Retries turn one expected failure into several and make the run history unreadable. Disable them on that task only.
- **Leaving max concurrent runs at the default.** Two versions registered close together will race, and the endpoint ends up serving whichever deployment task happened to finish last.
- **Renaming the approval task.** The match is on the task name starting with `approval`, and the tag key is that same name. Rename the task and the tag key changes with it, so an already-approved version stops being recognised.
