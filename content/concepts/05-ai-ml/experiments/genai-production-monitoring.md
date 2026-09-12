---
id: genai-production-monitoring
title: Production monitoring for GenAI apps
area: experiments
level: advanced
summary: Registered scorers run continuously against a sampled fraction of live traces and attach their verdicts to each trace as feedback, so quality drift shows up without a scheduled evaluation.
prerequisites: [agent-evaluation, mlflow-tracing]
related: [agent-framework, agent-deployment-apps, rag-pipeline, runs-monitoring]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/production-monitoring
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/concepts/production-quality-monitoring
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/tracing/prod-tracing
    checked: 2026-09-12
aliases: [production monitoring, online scoring, scheduled scorers, scorer sampling, ScorerSamplingConfig, continuous monitoring, online evaluation]
updated: 2026-09-12
status: published
maturity: beta
maturity_checked: 2026-09-12
---

> [!note]
> Production monitoring is in Beta as of September 2026, and a workspace admin controls access to it from the **Previews** page. It can change without notice and it is not on any exam guide. Read it to know it exists, not to build a quality SLA on it.

## What it is

Production monitoring runs the scorers from [[agent-evaluation]] against traffic instead of against a dataset. You take a scorer you already trust, **register** it against the MLflow experiment your app logs to, and **start** it with a sampling rate. From then on a fraction of incoming traces gets scored automatically, and each verdict is attached to its trace as feedback.

Nothing about the scorer changes. The same `Safety()` judge and the same `@scorer` function that graded fifty curated examples during development grade a sample of live requests in production. What changes is the input: traces arriving from real users, continuously, instead of a fixed evaluation set you assembled.

## Why it exists

[[agent-evaluation]] answers a question asked before a release: is this version better than the one we are running. It is a gate, and a gate only knows about the cases somebody thought to put in the dataset. Once the app is live the interesting failures are exactly the ones nobody thought of: a phrasing the retriever handles badly, a topic that arrived after launch, a model provider quietly changing behaviour behind the same version string.

The manual alternative is a weekly read of transcripts, which does not scale past a few hundred requests a day and catches nothing systematically. The other alternative, running `mlflow.genai.evaluate()` on a nightly export of traces, works but rebuilds the same plumbing every team writes once: sample the traces, run the scorers, write the results somewhere, keep it from re-scoring yesterday's rows. Registered scorers make that a managed service, and because the verdict lands on the trace itself rather than in a side table, the trace in [[mlflow-tracing]] is the single record of both what happened and whether it was any good.

## How it works

### Two calls: register, then start

Every scorer type follows the same two steps. `register(name=...)` puts the scorer on the server under a name unique within the experiment. `start(sampling_config=...)` begins online evaluation.

```python
from mlflow.genai.scorers import Safety, ScorerSamplingConfig

safety_judge = Safety().register(name="prod_safety")
safety_judge = safety_judge.start(sampling_config=ScorerSamplingConfig(sample_rate=0.7))
```

Registration and starting are separate on purpose: a registered scorer that has never been started, or one that has been stopped, still exists with its configuration intact.

### Sampling, and what the rate is for

`ScorerSamplingConfig` takes `sample_rate`, a fraction between 0.0 and 1.0 that defaults to 1.0, and an optional `filter_string` using MLflow's trace search syntax, so a scorer can be pointed at a subset such as `"trace.status = 'OK'"`.

The rate is a cost decision, because every sampled trace means a judge call. The documented rules of thumb:

| Situation | Rate |
| --- | --- |
| Safety and other checks you cannot afford to miss | `1.0` |
| Expensive judges on high-volume traffic | `0.05` to `0.2` |
| Iterating on a scorer, before you trust it | `0.3` to `0.5` |

Sampling applies to scoring, not to capture. Traces are still recorded in full: an app deployed with `agents.deploy(...)` gets `ENABLE_MLFLOW_TRACING` and `MLFLOW_EXPERIMENT_ID` set for it, so the complete history stays queryable even where only a twentieth of it carries a score.

### Where the results land

A verdict is attached to its trace as feedback, so it shows up on the trace in the experiment's **Traces** tab next to the spans that produced it, and it feeds the monitoring dashboards that plot the same scores over time. Allow 15 to 20 minutes after starting a scorer before expecting anything to appear.

Multi-turn judges work at session level rather than per request. A session is treated as complete when no new trace has arrived for five minutes, tunable with `MLFLOW_ONLINE_SCORING_DEFAULT_SESSION_COMPLETION_BUFFER_SECONDS`, and the assessment is attached to the **first** trace of the session. Looking for it on the last turn is a common few minutes wasted.

### Managing a running scorer

Scorer objects are immutable: `update()` and `stop()` return a new instance and leave the one you were holding alone.

| Call | Effect |
| --- | --- |
| `scorer.update(sampling_config=...)` | changes the rate or filter of a running scorer |
| `scorer.stop()` | sets `sample_rate` to 0 and leaves the scorer registered |
| `mlflow.genai.scorers.get_scorer(name=...)` | fetches one back by name |
| `mlflow.genai.scorers.list_scorers()` | lists every registered scorer on the experiment |
| `mlflow.genai.scorers.delete_scorer(name=...)` | removes the registration entirely |

At most **20 scorers** can be associated with one experiment for continuous monitoring at any time.

### What a custom scorer has to look like

The monitoring service serialises your function and runs it remotely, and that constraint explains all four rules:

- only `@scorer` decorated functions are supported, not subclasses of `Scorer`;
- the scorer must be defined and registered **from a Databricks notebook**, not a local file or an IDE;
- it has to be self-contained, with every import inside the function body, because references to module-level names and outer variables are not captured;
- no type hints in the signature that need an import, so `List[str]` from `typing` breaks it.

A scorer that works in a `mlflow.genai.evaluate()` call can therefore still fail to register. It is worth writing production scorers to these rules from the start rather than untangling them later.

### Prerequisites worth checking first

The experiment has to be receiving traces already, the scorers have to match your trace shape, a serverless budget policy has to apply, and if your traces are stored in Unity Catalog rather than in the experiment, a **SQL warehouse id** has to be configured or monitoring will not run. Traces logged by MLflow 2 are compatible.

## Example: promoting a development scorer into production

```python
import mlflow
from mlflow.genai.scorers import (
    Safety,
    RetrievalGroundedness,
    ScorerSamplingConfig,
    scorer,
    list_scorers,
)

mlflow.set_experiment("/Shared/support-assistant")

# Safety on everything: the cheap judge on the check you cannot miss.
Safety().register(name="prod_safety").start(
    sampling_config=ScorerSamplingConfig(sample_rate=1.0)
)

# Groundedness on a tenth of successful traces: the expensive judge, sampled.
RetrievalGroundedness().register(name="prod_groundedness").start(
    sampling_config=ScorerSamplingConfig(
        sample_rate=0.1,
        filter_string="trace.status = 'OK'",
    )
)

# A regression check for a bug this app has already shipped once.
# Every import is inside the body, and there are no type hints in the signature.
@scorer
def cites_a_source(outputs):
    import re

    return bool(re.search(r"https?://", str(outputs.get("response", ""))))

cites_a_source.register(name="prod_citation").start(
    sampling_config=ScorerSamplingConfig(sample_rate=0.3)
)

for s in list_scorers():
    print(s._server_name, s.sample_rate, s.filter_string)
```

Two weeks later, groundedness looks stable and the judge bill does not, so the rate comes down without touching the scorer:

```python
from mlflow.genai.scorers import get_scorer, ScorerSamplingConfig

get_scorer(name="prod_groundedness").update(
    sampling_config=ScorerSamplingConfig(sample_rate=0.05)
)
```

## Common mistakes

- **Registering a scorer from an IDE or a `.py` file.** Registration serialises the function from a notebook session. Outside one it fails, and the error points at serialisation rather than at the real cause.
- **Referencing a module-level constant inside a custom scorer.** The closure is not captured, so the scorer registers happily and then fails on real traffic. Put the constant inside the function.
- **Sampling safety at the same rate as the expensive judges.** Safety is the check where a missed case is the whole point. Run it at 1.0 and save the budget on the judges whose value is a trend.
- **Looking for a multi-turn assessment on the last trace of a session.** It is attached to the first, five minutes after traffic on that session stops.
- **Assuming a sampled score means a sampled trace.** Sampling governs scoring only; the traces are all still there to query, which is what makes a sudden score drop investigable.
- **Starting twenty scorers because twenty is the limit.** Each one is a judge call per sampled trace. A short list you read beats a long list nobody opens.
