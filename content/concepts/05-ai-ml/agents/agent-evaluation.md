---
id: agent-evaluation
title: Evaluating agents
area: agents
level: advanced
summary: mlflow.genai.evaluate() scores agent traces with built-in and custom judges, and the same scorers can run continuously in production.
prerequisites: [agent-framework, rag-pipeline]
related: [agent-framework, rag-pipeline, runs-monitoring]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/concepts/scorers
    checked: 2026-09-10
aliases: [mlflow genai evaluate, llm judges, agent monitoring, scorers, evaluation datasets]
updated: 2026-09-10
status: published
---

## What it is

Evaluating an agent means running it against a set of representative inputs and scoring the outputs with **scorers** — some are LLM judges, some are plain code — instead of eyeballing transcripts. `mlflow.genai.evaluate()` is the entry point: give it an agent (or a static set of already-collected outputs), a dataset, and a list of scorers, and it produces a table of per-example and aggregate scores tied to an MLflow run.

## Why it exists

An agent built with [[agent-framework]] can regress silently: a prompt tweak that fixes one question can break five others, and a model swap can change tone without changing correctness. Manual spot-checking doesn't scale and doesn't catch regressions consistently. Systematic evaluation turns "does this feel better" into a repeatable score you can compare across versions, and the same scoring logic that runs at development time can keep running once the agent is live.

## How it works

### Evaluation datasets from traces

The most useful evaluation examples come from real usage, not invented ones. Every call to an [[agent-framework]] agent produces an MLflow trace; you curate a set of these traces — optionally after the review app has attached expert feedback to them — into an evaluation dataset. This keeps the test set anchored to how people actually use the agent instead of a wishlist a developer imagined.

### Built-in judges

Databricks ships a handful of ready-made LLM judges as scorers so you don't have to write a prompt for common quality dimensions:

| Judge | Checks |
| --- | --- |
| **Correctness** | does the answer match the expected answer or facts |
| **Guidelines** | does the answer follow a rule you wrote in plain English (tone, format, forbidden content) |
| **Safety** | is the answer free of harmful or inappropriate content |
| **RetrievalGroundedness** | is every claim in the answer actually supported by the retrieved context, for a [[rag-pipeline]]-style agent |

Groundedness is deliberately a separate judge from correctness: an answer can be correct by accident without being backed by the retrieved chunks, and a grounded answer can still be wrong if the retrieved chunks themselves were bad — see the retrieval-vs-generation split in [[rag-pipeline]].

### Custom scorers

Not every quality dimension has a built-in judge. A custom scorer is a Python function decorated with `@scorer` that takes the input, output, and (optionally) trace, and returns a score — a boolean, a number, or a category. It can call an LLM with your own judge prompt, or run plain code (a regex check, a schema validator) when a judge is overkill.

### Aligning judges with human feedback

An LLM judge is itself a model and can disagree with what a human expert would say. Alignment means collecting a small set of examples where a person has labeled the "correct" verdict — often via the review app — and using that labeled set to calibrate the judge's prompt or few-shot examples until its verdicts track the human's more closely. Skipping this step means trusting a judge that was never checked against your actual definition of quality.

### Production monitoring on traces

The same scorers used during development can run continuously against live production traces instead of a fixed test set, flagging quality drift as it happens rather than at the next scheduled evaluation. This closes the loop: development evaluation decides whether a change ships, production monitoring watches what ships once real traffic hits it.

## Example

```python
import mlflow
from mlflow.genai.scorers import Correctness, Guidelines, RetrievalGroundedness, scorer

@scorer
def answer_has_citation(outputs, trace):
    return "source:" in outputs["content"].lower()

results = mlflow.genai.evaluate(
    predict_fn=my_agent.predict,
    data=eval_dataset,
    scorers=[
        Correctness(),
        Guidelines(guidelines="Never mention internal ticket numbers."),
        RetrievalGroundedness(),
        answer_has_citation,
    ],
)
```

```python
mlflow.genai.evaluate(
    predict_fn=my_agent.predict,
    data=production_traces,  # scored continuously as a monitor, not a one-off run
    scorers=[Correctness(), RetrievalGroundedness()],
)
```

## Common mistakes

- Building an evaluation dataset from hand-written questions instead of real traces, then being surprised production quality doesn't match the eval score.
- Treating a judge's verdict as ground truth without ever aligning it against a human label.
- Running Correctness on a RAG agent but never RetrievalGroundedness, so a well-worded but unsupported answer scores fine.
- Evaluating only at development time and finding out about drift from user complaints instead of production monitoring.

> [!tip]
> Add one custom scorer per hard-won production bug — over time your scorer list becomes a regression suite that encodes exactly the mistakes your agent has already made once.
