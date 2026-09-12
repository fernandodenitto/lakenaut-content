---
id: prompt-registry
title: Prompt registry
area: experiments
level: intermediate
summary: The MLflow prompt registry stores prompt templates as versioned Unity Catalog objects with aliases for production, so a prompt change can be evaluated and rolled back like a model version.
prerequisites: [agent-evaluation, mlflow-tracking]
related: [evaluation-datasets, human-feedback, models-in-uc, rag-pipeline, mlflow-tracing]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/prompt-version-mgmt/prompt-registry/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/prompt-version-mgmt/prompt-registry/create-and-edit-prompts
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/prompt-version-mgmt/prompt-registry/use-prompts-in-deployed-apps
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/prompt-version-mgmt/prompt-registry/evaluate-prompts
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/prompt-version-mgmt/prompt-registry/automatically-optimize-prompts
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/supported-models
    checked: 2026-09-12
aliases: [mlflow prompt registry, prompt versioning, register_prompt, load_prompt, prompt alias, optimize_prompts, GEPA]
updated: 2026-09-12
status: published
maturity: beta
maturity_checked: 2026-09-12
---

> [!note]
> The prompt registry is in **Beta** as of September 2026, and a workspace admin controls access to it from the Previews page. It can change without notice and it is not on any exam guide. Read it to know it exists, not to build a critical path on it.

## What it is

The **prompt registry** stores a prompt template as an object in Unity Catalog instead of as a string in your source code. A prompt has a three-level name such as `main.genai.support_summary`, immutable versions numbered automatically as you register new text against that name, and mutable **aliases**, named pointers such as `production` or `staging` that you move from one version to another.

The template itself is text with `{{variable}}` placeholders, registered as either a **Text** prompt for completion-style models or a **Chat** prompt for role-based messages. Everything else about it, the commit message, the tags, who owns it, who may read it, is metadata on the Unity Catalog object.

If that shape feels familiar, it is deliberate: it is the same versions-and-aliases model that [[models-in-uc]] uses for models, applied to the other artefact that decides an application's behaviour.

## Why it exists

A prompt is the highest-leverage and least governed thing in a generative AI application. It usually lives as a triple-quoted string somewhere in the middle of a module, edited by whoever was on call, with no record of what it said last Tuesday and no way to connect a complaint about an answer to the wording that produced it.

Two problems follow from that. The first is reversibility: once the prompt is code, changing it means a commit, a review, a deploy, so a one-word fix takes a release cycle, and rolling back a bad wording takes another. The second is authorship: the people best placed to improve a prompt, the support lead who knows which phrasing confuses customers or the lawyer who knows which sentence must appear, cannot open a Python file, so their improvements arrive as emails to an engineer.

Registering the prompt separates its lifecycle from the application's. A version number makes changes comparable, an alias makes them deployable without a redeploy, Unity Catalog makes them governed, and the registry UI makes them editable by someone who does not write Python.

## How it works

### Requirements

The prompt registry needs `mlflow[databricks]` 3.1.0 or later (see [[mlflow-3-models]] for why the floor matters), an existing MLflow experiment, and `CREATE FUNCTION`, `EXECUTE` and `MANAGE` on the Unity Catalog schema that will hold the prompts. Those are function privileges rather than table privileges, which is worth knowing when you ask a governance team for access: granting `CREATE TABLE` on the schema will not do it.

### Registering and loading

```python
import mlflow

prompt = mlflow.genai.register_prompt(
    name="main.genai.support_summary",
    template="Summarise the ticket in {{num_sentences}} sentences.\n\nTicket: {{content}}",
    commit_message="Initial version",
    tags={"author": "support-platform@example.com", "use_case": "ticket_summary"},
)
```

Calling `register_prompt` again with the same name creates the next version; nothing is ever overwritten. Loading takes a `prompts:/` URI, by version for a pinned read or by alias for a live one, and `.format()` fills the placeholders:

```python
pinned = mlflow.genai.load_prompt(name_or_uri="prompts:/main.genai.support_summary/3")
live = mlflow.genai.load_prompt(name_or_uri="prompts:/main.genai.support_summary@production")

messages = [{"role": "user", "content": live.format(num_sentences=2, content=ticket_text)}]
```

`mlflow.genai.search_prompts()` finds prompts by name, tags or metadata, and `mlflow.client.MlflowClient().delete_prompt()` removes a prompt or a single version.

### Aliases and deployment

```python
mlflow.genai.set_prompt_alias(name="main.genai.support_summary", alias="production", version=4)
```

An alias points at one version at a time, and moving it is a metadata update. The pattern the documentation recommends for a deployed application is to hold the prompt name and the alias in configuration and load by alias at request time, so promoting a new wording or reverting to the previous one never touches the deployment. There is no latency argument against it either: the MLflow client caches the template, so the registry is not in the hot path of every call. `mlflow.genai.delete_prompt_alias()` removes an alias when an environment goes away.

The corollary matters as much: an **evaluation** run should pin a version, not an alias, or the thing you measured changes underneath the result.

### Evaluating one version against another

This is what makes the registry more than a filing cabinet. Write a prediction function that takes a version, loads that exact prompt and calls the model, then run [[agent-evaluation|mlflow.genai.evaluate()]] once per version over the same [[evaluation-datasets|evaluation dataset]]. Each version becomes an MLflow run you can compare score by score, and because the prompt version is an input to the run rather than a detail of the code, the comparison survives the next person to look at it.

### Automated optimisation

`mlflow.genai.optimize_prompts()` rewrites a prompt for you against your own scorers. It is also in Beta and needs `mlflow` 3.5.0 or later, a higher floor than the registry itself. You pass `predict_fn`, `train_data`, `prompt_uris`, `scorers` and an `optimizer`; the one Databricks ships is `GepaPromptOptimizer`, an implementation of the GEPA algorithm researched by the Databricks AI research team, which refines a prompt iteratively using a reflection model and the feedback the scorers produce. `reflection_model` chooses the model doing the rewriting and `max_metric_calls` caps the budget. Improved prompts are registered back as new versions.

One requirement is easy to get wrong: `predict_fn` has to load the prompt through `mlflow.genai.load_prompt()` and call `.format()` on it. A hardcoded string inside the function is invisible to the optimiser, which will report improvements that change nothing.

## Example: two versions, one dataset, one winner

```python
%pip install --upgrade "mlflow[databricks]>=3.1.0"
dbutils.library.restartPython()
```

```python
import mlflow
from mlflow.genai.scorers import Correctness, Guidelines
from openai import OpenAI

mlflow.set_experiment("/Shared/ticket-summariser")
PROMPT = "main.genai.support_summary"
client = OpenAI()  # or a Databricks model serving client

mlflow.genai.register_prompt(
    name=PROMPT,
    template="Summarise the ticket in {{num_sentences}} sentences.\n\nTicket: {{content}}",
    commit_message="v1: plain instruction",
)
mlflow.genai.register_prompt(
    name=PROMPT,
    template=(
        "You are a support lead. Summarise the ticket in {{num_sentences}} sentences, "
        "naming the affected product and the action the customer must take.\n\nTicket: {{content}}"
    ),
    commit_message="v2: role and required elements",
)

def summariser(version: int):
    def predict(content: str):
        prompt = mlflow.genai.load_prompt(name_or_uri=f"prompts:/{PROMPT}/{version}")
        reply = client.chat.completions.create(
            model="databricks-claude-sonnet-4-5",
            messages=[{"role": "user", "content": prompt.format(num_sentences=2, content=content)}],
        )
        return reply.choices[0].message.content
    return predict

for version in (1, 2):
    with mlflow.start_run(run_name=f"prompt-v{version}"):
        mlflow.genai.evaluate(
            predict_fn=summariser(version),
            data=mlflow.genai.datasets.get_dataset(name="main.genai.ticket_eval"),
            scorers=[Correctness(), Guidelines(guidelines="Name the product and the required action.")],
        )

# v2 wins, so production points at it; the application does not change
mlflow.genai.set_prompt_alias(name=PROMPT, alias="production", version=2)
```

The prompt text appears exactly once per version, in the registry. The evaluation loop references versions, the application references the alias, and nobody has to diff two notebooks to find out what changed.

## Common mistakes

- **Hardcoding the prompt inside `predict_fn`.** Both evaluation and `optimize_prompts()` load the prompt themselves; if the function ignores the loaded template, you are measuring and optimising a string the registry never sees.
- **Loading by alias in an evaluation run.** The alias moves, so the run is no longer reproducible. Pin the version when you are measuring and use the alias only when you are serving.
- **Pinning a version in the deployed application.** The opposite mistake, and it throws away the reason to use aliases: every prompt fix becomes a redeploy.
- **Asking for `CREATE TABLE` on the schema.** The privileges are `CREATE FUNCTION`, `EXECUTE` and `MANAGE`. This is the most common reason a first `register_prompt` call fails.
- **Assuming one version floor.** The registry needs 3.1.0, `optimize_prompts()` needs 3.5.0, and a client that is new enough for one is not necessarily new enough for the other.
- **Editing a prompt in the UI and shipping it without evaluating it.** The registry makes a change cheap to make and cheap to revert; it does not tell you whether the change was an improvement. That is what the dataset in [[evaluation-datasets]] is for.
