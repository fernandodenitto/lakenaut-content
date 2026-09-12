---
id: evaluation-datasets
title: Evaluation datasets for generative AI
area: experiments
level: intermediate
summary: An evaluation dataset is a governed Unity Catalog table of inputs and expectations, curated from traces, expert labels, synthetic generation or by hand, that an agent is scored against on every change.
prerequisites: [agent-evaluation, mlflow-tracing]
related: [agent-evaluation, human-feedback, prompt-registry, rag-pipeline, mlflow-tracing]
exams:
  - cert: genai-engineer-associate
    domain: "Evaluation and Monitoring"
    objective: "Identify evaluation judges that require ground truth."
sources:
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/build-eval-dataset
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/concepts/eval-datasets
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/generative-ai/agent-evaluation/synthesize-evaluation-set
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/human-feedback/concepts/labeling-sessions
    checked: 2026-09-12
aliases: [eval dataset, evaluation set, golden dataset, ground truth, expectations, expected_facts, regression suite]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

An **evaluation dataset** is the fixed set of examples an application is scored against. Each record has `inputs`, a dictionary holding whatever the application takes (a question, a conversation, some context), and optionally `expectations`, a dictionary holding what a correct answer would look like. On Databricks a dataset created through `mlflow.genai.datasets` is a table in Unity Catalog attached to an MLflow experiment, so it has an owner, grants, a history and lineage rather than living in a notebook variable.

`expectations` has reserved keys that the built-in judges in [[agent-evaluation]] look for, and knowing which judge needs which key is most of the skill:

| Key | Used by |
| --- | --- |
| `expected_response` | the Correctness judge, as the answer to compare against |
| `expected_facts` | the Correctness judge, as a list of claims that must appear |
| `guidelines` | the Guidelines judge, as rules written in plain English |
| `expected_retrieved_context` | the document recall scorer, as the documents that should have been retrieved |

Judges that need none of these, such as Safety or a groundedness check, can score an unlabelled record. Correctness cannot, which is why a dataset with inputs and nothing else quietly produces fewer scores than you expected.

MLflow fills in the rest itself: `dataset_record_id`, `create_time` and `created_by`, `last_update_time` and `last_updated_by`, `tags`, and a `source` struct saying where the record came from, as `human` with a user name, `document` with a `doc_uri`, or `trace` with a `trace_id`.

## Why it exists

Every part of a generative AI application is replaceable. The base model gets swapped for a cheaper one, the chunk size changes, the prompt is rewritten, the framework is upgraded, the retriever moves from keyword to hybrid search. What does not change is the set of things users ask it to do.

That asymmetry is the whole argument. If the examples move whenever the application moves, no comparison means anything: 0.82 this week against 0.79 last week could be a regression, or could be three new questions somebody added. Hold the dataset still and the score becomes a signal; hold it still for a year and it becomes a regression suite encoding every failure the application has already been caught making.

The habit this replaces is a list of hand-written questions in the notebook of whoever last worked on the project: invented rather than observed, undiscoverable, and gone when the notebook is. In Unity Catalog the dataset gets the same governance as the tables the application reads, and a record can point at the exact trace it came from.

## How it works

### Creating and updating

```python
import mlflow.genai.datasets

eval_dataset = mlflow.genai.datasets.create_dataset(name="main.genai.support_eval")
# later, from anywhere
eval_dataset = mlflow.genai.datasets.get_dataset(name="main.genai.support_eval")
```

Records go in through `merge_records()`, which is an upsert rather than an append: re-running the same curation does not duplicate anything. For records synced from a labelling session the trace inputs act as the key, expectations with matching names overwrite the existing values, and traces not yet present are added as new records.

Requirements are small: `CREATE TABLE` on a Unity Catalog schema and an MLflow experiment to attach the dataset to. The limits are not: **2,000 rows per dataset** and **20 expectations per record**. A dataset also cannot live in a catalog encrypted with customer-managed keys, although a workspace with CMK enabled is fine as long as the dataset sits in a non-CMK catalog.

Treat the row cap as a design constraint rather than an annoyance: 2,000 records judged by an LLM is already a meaningful bill and a slow loop, so the shape to aim for is one focused dataset per problem, not one enormous dataset per team.

### Four ways to fill it

| Source | How | When it is the right choice |
| --- | --- | --- |
| Production traces | `mlflow.search_traces()` with a filter, then `merge_records(traces)` | the default once the application has traffic: the examples are real by construction |
| Expert labels | a labelling session, then `session.sync(dataset_name=...)` | when the expectation needs domain knowledge a developer does not have |
| Synthetic generation | `generate_evals_df()` over a documents DataFrame | cold start, before there is any traffic to curate from |
| By hand | a list of dicts passed to `merge_records` | one record per bug you have already fixed, added the day you fix it |

Curating from traces is the method the documentation pushes hardest, and it is what connects this page to [[mlflow-tracing]]: a trace carries latency, token usage, status and any score already attached to it, so you can filter for exactly the traffic worth testing against. The slow calls, the failed ones, the ones carrying a thumbs-down, the ones where a judge and a human disagreed.

```python
import mlflow

traces = mlflow.search_traces(
    filter_string="attributes.status = 'OK' AND tags.environment = 'production'",
    order_by=["attributes.timestamp_ms DESC"],
    max_results=100,
)
eval_dataset = eval_dataset.merge_records(traces)
```

Expert labels come from a labelling session or a review queue, both covered in [[human-feedback]]. A session is itself an MLflow run, and `sync()` pushes the expectations the reviewers recorded into the dataset:

```python
import mlflow.genai.labeling as labeling

sessions = labeling.get_labeling_sessions()
sessions[0].sync(dataset_name="main.genai.support_eval")
```

Synthetic generation answers the chicken-and-egg problem of a brand new [[rag-pipeline]]: no traces, because nobody is using it yet. `generate_evals_df` from the `databricks-agents` package takes a DataFrame with `content` and `doc_uri` columns and writes questions from the documents themselves, spreading `num_evals` of them across the corpus in rough proportion to length, steered by the free-text `agent_description` and `question_guidelines`. On MLflow 3 the output already has the right shape: `inputs` plus an `expectations` dictionary with `expected_facts` and `expected_retrieved_context`.

### Versioning and lineage

The dataset inherits Unity Catalog governance, and MLflow tracks per-record provenance on top: who created a record and when, who last changed it, and the `source` struct linking it back to the trace, document or person it came from. In the UI a trace-sourced record opens the original trace with all its assessments, which is how you answer, months later, why a particular expectation says what it says.

## Example: a dataset built from production traces and hand-written regression cases

```python
import mlflow
import mlflow.genai.datasets
from mlflow.genai.scorers import Correctness, Guidelines, RetrievalGroundedness

mlflow.set_experiment("/Shared/support-assistant")

dataset = mlflow.genai.datasets.create_dataset(name="main.genai.support_eval")

# 1. Real traffic, the failed calls first: the highest-value examples there are
failed = mlflow.search_traces(
    filter_string="attributes.status = 'ERROR' AND tags.environment = 'production'",
    order_by=["attributes.timestamp_ms DESC"],
    max_results=50,
)
dataset = dataset.merge_records(failed)

# 2. Regression cases written by hand, one per bug already fixed
dataset = dataset.merge_records([
    {
        "inputs": {"question": "Why did my SQL warehouse not auto-stop last night?"},
        "expectations": {
            "expected_facts": [
                "a running query or an open session keeps the warehouse alive",
                "the auto-stop timer restarts on activity",
            ],
            "guidelines": ["Never quote an internal ticket number."],
        },
        "tags": {"origin": "incident-4417"},
    },
])

results = mlflow.genai.evaluate(
    predict_fn=support_assistant,
    data=dataset,
    scorers=[
        Correctness(),
        Guidelines(guidelines="Never quote an internal ticket number."),
        RetrievalGroundedness(),
    ],
)
```

The two halves do different jobs: the traces keep the dataset honest about how the application is used, the hand-written records keep it honest about mistakes that must never come back. Run the same call after a prompt change and the diff between the two MLflow runs is the answer to whether the change helped.

## Common mistakes

- **Writing the questions yourself and stopping there.** An invented dataset measures the application against a developer's imagination. Curate from traces as soon as there is any traffic, and keep the hand-written records only as regression cases.
- **Recording inputs but no expectations, then wondering why Correctness reports nothing.** Correctness needs `expected_response` or `expected_facts` and document recall needs `expected_retrieved_context`. Judges that need no ground truth, such as Safety, will still score, which is what makes the gap easy to miss.
- **Treating 2,000 rows as a target.** Every record costs a judge call on every run, and a tight dataset covering distinct failure modes beats a large one full of near-duplicates.
- **Keeping the dataset as a pandas DataFrame in a notebook.** It works for one afternoon, then nobody else can reproduce the score and no history says who changed an expectation.
- **Never adding the incident.** The first time production produces a wrong answer, that answer is a free regression test. If it does not end up in the dataset the same week, it will happen again.

> [!exam]
> The Generative AI Engineer Associate guide asks you to identify which evaluation judges require ground truth, and the dataset schema is where that answer lives: Correctness needs `expected_response` or `expected_facts`, the Guidelines judge needs `guidelines`, document recall needs `expected_retrieved_context`, while Safety and groundedness score an unlabelled record. Know that the fields are `inputs` and `expectations` (not the MLflow 2 `request` and `expected_response` columns), that the dataset is a Unity Catalog table, and that curating from production traces is the recommended way to build one.
