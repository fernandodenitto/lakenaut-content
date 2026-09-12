---
id: mlflow-tracing
title: MLflow Tracing for GenAI applications
area: experiments
level: intermediate
summary: MLflow Tracing records each GenAI request as a tree of spans carrying inputs, outputs, latency and token counts, stored in an MLflow experiment or in Unity Catalog.
prerequisites: [mlflow-tracking, rag-pipeline]
related: [agent-evaluation, agent-framework, model-serving-endpoints, vector-search-basics]
exams:
  - cert: genai-engineer-associate
    domain: "Evaluation and Monitoring"
    objective: "Evaluate agent performance using MLflow scoring and tracing."
sources:
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/tracing/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/tracing/app-instrumentation/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/tracing/app-instrumentation/automatic
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/tracing/app-instrumentation/manual-tracing/function-decorator
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/tracing/app-instrumentation/manual-tracing/span-tracing
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/tracing/span-concepts
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/tracing/observe-with-traces/access-trace-data
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/tracing/trace-unity-catalog
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/tracing/prod-tracing
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/production-monitoring
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/ai-gateway/query-model-services
    checked: 2026-09-11
aliases: [mlflow tracing, trace, span, spans, genai observability, agent tracing, autolog tracing, otel traces]
updated: 2026-09-11
status: published
maturity: ga
---

## What it is

**MLflow Tracing** is the observability layer for generative AI code. One call into your application produces one **trace**: the record of everything that happened between the request arriving and the answer going out. A trace is a tree of **spans**, and a span is one step of that work: a retrieval, a tool call, a model invocation, a parsing routine.

A span carries `span_id`, `trace_id` and `parent_id` (`None` on the root span, which is what makes the tree a tree), a `name`, `start_time_ns` and `end_time_ns`, a `status` of `OK`, `UNSET` or `ERROR`, its `inputs` and `outputs`, a dictionary of `attributes`, and `events`, where exceptions and stack traces land. Each span also has a type: `CHAT_MODEL`, `CHAIN`, `AGENT`, `TOOL`, `EMBEDDING`, `RETRIEVER`, `PARSER`, `RERANKER`, `MEMORY`, `UNKNOWN`, or a string of your own.

This is not the same feature as [[mlflow-tracking]]. Tracking answers "which hyperparameters produced this model"; tracing answers "which retrieved chunk made this answer wrong".

## Why it exists

A bad answer from a [[rag-pipeline]] is never one bug. The retriever may have returned the wrong chunks, the prompt template may have truncated them, the model may have ignored them, or the parser may have mangled a perfectly good response. From the outside all four failures look identical: a string that reads plausibly and is wrong.

The habit before tracing was to scatter print statements through the chain and, in production, log prompts and completions to a table nobody agreed on the schema of. That gives you the two ends and nothing in between, and it never survives a framework upgrade. Tracing makes the intermediate steps a first-class artefact with a fixed shape, so the same record can be read by a human in a UI, by an LLM judge during evaluation, and by a SQL query six months later.

## How it works

### Automatic instrumentation

For a supported library, tracing is one line: `mlflow.<library>.autolog()`. More than twenty integrations ship with MLflow, including:

| Library | Call |
| --- | --- |
| OpenAI, and Databricks foundation models through an OpenAI-compatible client | `mlflow.openai.autolog()` |
| LangChain and LangGraph | `mlflow.langchain.autolog()` |
| Anthropic | `mlflow.anthropic.autolog()` |
| DSPy | `mlflow.dspy.autolog()` |
| Bedrock | `mlflow.bedrock.autolog()` |
| AutoGen | `mlflow.autogen.autolog()` |

Turn one off with `mlflow.<library>.autolog(disable=True)` and all of them with `mlflow.autolog(disable=True)`. One trap worth remembering: **on serverless compute, GenAI autologging is not switched on for you**, so the `autolog()` call has to be explicit.

### Manual spans

Automatic tracing only sees the library calls. Your own retrieval helper, your chunk re-ranker and your business rules are invisible until you say otherwise. Two APIs cover that:

- `@mlflow.trace` decorates a function and takes `name`, `span_type`, `attributes` and `output_reducer` (for generators). It records the arguments as the span's inputs, the return value as its outputs, the wall-clock latency, and any exception as a span event.
- `mlflow.start_span(name=...)` is a context manager for an arbitrary block, with `span.set_inputs()`, `span.set_outputs()`, `span.set_attribute()`, `span.set_attributes()`, `span.set_status()` and `span.add_event()` to fill it in by hand.

Mixing the two is the normal case: `autolog()` for the model calls, a decorator on everything around them.

### What gets recorded

Beyond per-span inputs and outputs, `trace.info` exposes `trace_id`, `execution_duration`, a `state` of `OK`, `ERROR` or `IN_PROGRESS`, mutable `tags`, immutable `trace_metadata`, and `token_usage`, a dictionary with `input_tokens`, `output_tokens` and `total_tokens`. Token counts come from what the provider returns, so they are the real billed numbers rather than an estimate. `trace.data.spans` gives the span list, and `mlflow.search_traces()` pulls traces back programmatically.

### The two storage backends

| | MLflow experiment | Unity Catalog (recommended) |
| --- | --- | --- |
| Where traces land | the experiment's own store | OpenTelemetry Delta tables in a UC schema |
| Volume | capped at 100,000 traces per experiment | no per-experiment cap |
| Querying | the trace UI and the search API | the same, plus SQL over Delta |
| Access control | experiment ACLs | [[privileges-grant-revoke]] |

Binding an experiment to Unity Catalog creates four tables from a prefix you choose: `<prefix>_otel_spans`, `<prefix>_otel_logs`, `<prefix>_otel_metrics` and `<prefix>_otel_annotations`. It needs `mlflow[databricks]` 3.14 or later, a SQL warehouse, and `USE CATALOG`, `USE SCHEMA`, plus `MODIFY` and `SELECT` on each of those four tables. `ALL PRIVILEGES` on the schema is not enough, which catches almost everybody once. Ingestion is capped at 200 traces per second per workspace and 100 MB per second per table, and single traces cannot be deleted: you delete rows with SQL.

### Into evaluation and monitoring

A trace is the input format for [[agent-evaluation]]. `mlflow.genai.evaluate()` takes scorers, and a custom scorer written with `@scorer` receives the inputs, the outputs, the expectations and the complete trace with every span, so a judge can score retrieval quality separately from answer quality. Production closes the loop: an agent deployed with `agents.deploy(...)` gets `ENABLE_MLFLOW_TRACING` and `MLFLOW_EXPERIMENT_ID` set for it, and monitoring re-runs the same scorers over a sample of live traces with `scorer.register(name=...)` followed by `scorer.start(sampling_config=ScorerSamplingConfig(sample_rate=...))`, attaching the result as feedback on the trace. Production monitoring is in Beta as of September 2026 and is capped at 20 scorers per experiment.

## Example: tracing a retrieval-augmented call

Retrieval through [[vector-search-basics|AI Search]], generation through a governed model service, traces in Unity Catalog.

```python
import json, os, mlflow
from mlflow.entities import SpanType
from mlflow.entities.trace_location import UnityCatalog
from databricks.ai_search.client import AISearchClient
from openai import OpenAI

mlflow.set_tracking_uri("databricks")
os.environ["MLFLOW_TRACING_SQL_WAREHOUSE_ID"] = "<warehouse-id>"

mlflow.set_experiment(
    experiment_name="/Shared/support-assistant",
    trace_location=UnityCatalog(
        catalog_name="main",
        schema_name="observability",
        table_prefix="support_assistant",
    ),
)

mlflow.openai.autolog()  # every chat completion becomes a span, token counts included

index = AISearchClient().get_index(index_name="main.rag.docs_index")
llm = OpenAI(
    api_key=os.environ["DATABRICKS_TOKEN"],
    base_url="https://<workspace-url>/ai-gateway/mlflow/v1",
)

@mlflow.trace(span_type=SpanType.RETRIEVER, attributes={"index": "main.rag.docs_index"})
def retrieve(question: str, k: int = 5) -> str:
    hits = index.similarity_search(
        query_text=question,
        columns=["chunk_text", "source_url"],
        num_results=k,
        query_type="hybrid",
    )
    return json.dumps(hits, default=str)

@mlflow.trace(name="support_assistant", span_type=SpanType.AGENT)
def answer(question: str) -> str:
    context = retrieve(question)
    reply = llm.chat.completions.create(
        model="system.ai.claude-sonnet-4-5",
        messages=[
            {"role": "system", "content": f"Answer only from this context:\n{context}"},
            {"role": "user", "content": question},
        ],
    )
    return reply.choices[0].message.content

answer("why did my SQL warehouse not auto-stop last night?")
```

One call produces one trace with three spans: the `support_assistant` root, the `retrieve` child, and the chat completion the autologger added. The root span's `execution_duration` is the latency the user felt, `trace.info.token_usage.get('total_tokens')` is what the call cost, and because the traces are Delta tables in `main.observability`, the same numbers are available to a SQL query over every request the app has ever served.

## Common mistakes

- **Instrumenting only the model call.** `autolog()` alone gives you a prompt and a completion with a black box between them. The retrieval step is where most RAG bugs live, so it needs its own span.
- **Leaving production traces in an experiment.** The 100,000-trace cap is reached quickly by a live app, and you lose the SQL access that makes trend analysis possible. Bind the experiment to Unity Catalog before launch, not after.
- **Granting `ALL PRIVILEGES` on the schema and expecting UC traces to work.** The four `_otel_*` tables need `MODIFY` and `SELECT` granted on them explicitly.
- **Assuming autologging is on because it was on in a classic cluster.** On serverless compute you have to call `mlflow.<library>.autolog()` yourself.
- **Treating a trace as a log line.** Tags and attributes are what make traces searchable later; a trace with no user id, no session and no app version is hard to act on when a complaint arrives a week later.

> [!exam]
> The Generative AI Engineer Associate guide asks you to evaluate agent performance "using MLflow scoring and tracing", so know the vocabulary exactly: a **trace** is one request, a **span** is one step, and `span_type` values such as `RETRIEVER`, `TOOL` and `CHAT_MODEL` are what let a scorer judge retrieval separately from generation. Know that automatic tracing is one `mlflow.<library>.autolog()` call per library while custom code needs `@mlflow.trace`, and that the same scorers run offline through `mlflow.genai.evaluate()` and online over sampled production traces. The distinction that catches people: tracing records what happened, scorers decide whether it was any good.
