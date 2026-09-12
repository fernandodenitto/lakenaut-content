---
id: human-feedback
title: Human feedback on generative AI output
area: experiments
level: intermediate
summary: Human judgement reaches MLflow as assessments on a trace, from developers annotating in the UI, from experts working a review queue, and from end users pressing thumbs up or down.
prerequisites: [mlflow-tracing, agent-evaluation]
related: [evaluation-datasets, agent-evaluation, prompt-registry, agent-deployment-apps, mlflow-tracing]
exams:
  - cert: genai-engineer-associate
    domain: "Evaluation and Monitoring"
    objective: "Incorporate SME feedback to improve agent performance."
sources:
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/human-feedback/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/human-feedback/dev-annotations
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/human-feedback/expert-feedback/review-queues
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/human-feedback/expert-feedback/label-existing-traces
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/human-feedback/concepts/labeling-sessions
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/mlflow3/genai/tracing/collect-user-feedback/
    checked: 2026-09-12
aliases: [review app, review queues, labeling session, label schema, assessments, log_feedback, log_expectation, thumbs up, SME feedback]
updated: 2026-09-12
status: published
maturity: ga
maturity_checked: 2026-09-12
---

## What it is

Human feedback in MLflow is stored as an **assessment** attached to a [[mlflow-tracing|trace]], or to a single span inside one. There are two kinds, and the distinction runs through everything else on this page:

| Kind | Question it answers | Logged with |
| --- | --- | --- |
| **Feedback** | was what the application produced any good | `mlflow.log_feedback()` |
| **Expectation** | what should it have produced | `mlflow.log_expectation()` |

Feedback is a verdict on an output. An expectation is ground truth, which is why it is the one that ends up in an [[evaluation-datasets|evaluation dataset]] and gets reused on every future run.

Every assessment carries an `AssessmentSource` with a `source_type` of `HUMAN`, `LLM_JUDGE` or `CODE` and a `source_id` naming the person or system. That is how a judge's score and a person's score sit on the same trace without being confused for one another, which is what you need in order to check whether the judge agrees.

Feedback arrives from three directions: developers annotating traces while building, domain experts working a structured queue, and end users pressing a button in the live application.

## Why it exists

Automated scoring in [[agent-evaluation]] rests on two things a machine cannot produce on its own. The first is the ground truth that judges like Correctness need: which facts must appear in an answer about a refund policy is a question for whoever owns the refund policy. The second is calibration, because an LLM judge is a model with a prompt, and until its verdicts have been compared against a person's, "the judge says 0.9" means only that the judge says so.

The habit this replaces is a spreadsheet of transcripts emailed to an expert who replies in prose three weeks later. Nothing in that loop is executable, so the next release repeats the mistake. Attaching the judgement to the trace puts it on the same object the evaluation harness already reads, and an expert's verdict becomes an expectation in a dataset with no copy step in between.

## How it works

### Developers annotating during development

The lowest-ceremony path. In the experiment UI, open the **Traces** tab, open a trace, pick a span (the root span if you are judging the whole call), expand the **Assessments** panel and fill in the form: type, name, data type, value, optional rationale. The label then appears as a column in the traces list, so you can sort by it. In code it is `mlflow.log_feedback()` and `mlflow.log_expectation()`.

### Review queues, for experts

> [!note]
> Review queues are in **Beta**. A workspace admin turns them on from Manage previews by enabling MLflow Review Queues. Databricks recommends them for new human-review work, but they can change without notice.

A review queue routes traces and dataset records to named reviewers in a one-item-at-a-time workspace. You create one from the **Reviews** tab of the experiment: **New queue**, a name, the reviewers, and the questions they answer, with a live preview of what they will see. Their view puts the item on the left and the questions on the right, with a progress bar and previous and next controls; answers can be pass/fail, a category, a number or free text.

Where the answers land depends on what was queued: answers on a **trace** become assessments on that trace, answers on a **dataset record** become expectations on that record. The second is the shortest path there is from expert knowledge to a reusable test.

### Labelling sessions, the older path

Review queues fold two older objects into one, and you will still meet both in existing projects. A **label schema** defines one question; a **labelling session** holds traces plus the schemas to apply to them, and is itself a special kind of MLflow run. This path needs `mlflow` 3.14.0 or later with `databricks-connect>=16.1`.

```python
from mlflow.genai.label_schemas import create_label_schema, InputCategorical, InputText
from mlflow.genai.labeling import create_labeling_session
import mlflow

summary_quality = create_label_schema(
    name="summary_quality",
    type="feedback",
    title="Is this summary concise and helpful?",
    input=InputCategorical(options=["Yes", "No"]),
    instruction="Please provide a rationale below.",
    enable_comment=True,
    overwrite=True,
)
expected_summary = create_label_schema(
    name="expected_summary",
    type="expectation",
    title="What should the summary have said?",
    input=InputText(),
    overwrite=True,
)

session = create_labeling_session(
    name="label_summaries",
    assigned_users=["domain.expert@example.com"],
    label_schemas=[summary_quality.name, expected_summary.name],
)
session.add_traces(mlflow.search_traces(max_results=50))

# read the labels back, then push the expectations into a dataset
labelled = mlflow.search_traces(run_id=session.mlflow_run_id)
session.sync(dataset_name="main.genai.support_eval")
```

`sync()` is an upsert keyed on the trace inputs: matching expectation names overwrite, new traces become new records.

### What a reviewer needs

This is the question that stalls most rollouts, because the answer is not "give them the workspace". A reviewer needs an identity in the Databricks **account** and nothing more; workspace access is not required. For people who are not already workspace users, an account admin provisions them with account-level SCIM from the identity provider.

| Surface | What the reviewer needs |
| --- | --- |
| Review queue | to be assigned to the queue, plus **Can Read** on the experiment |
| Creating or administering a queue | **Can Edit** or **Can Manage** on the experiment |
| Labelling session | to be assigned to the session: assignment automatically grants `WRITE` on the experiment holding it |
| Labelling existing traces | `CAN_EDIT` on the experiment |
| The Review App chat UI | `CAN_QUERY` on the model serving endpoint |

Two consequences follow. The experiment is the unit of access control, not the individual trace, so anything sensitive in the traces you queue is visible to every reviewer. And a queue with no assigned reviewers is invisible even to someone who can read the experiment: assignment is what routes the work.

### End users pressing thumbs up or down

The cheapest source of signal, and the easiest to get wrong, because the browser has to send back something that identifies the trace. In a chat app built as in [[agent-deployment-apps]] there are two ways:

- the application returns the MLflow trace id with the answer, taken inside the handler with `mlflow.get_current_active_span().trace_id`, and the feedback request quotes it back;
- or the application generates its own id, records it on the trace with `mlflow.update_current_trace(tags={"client_request_id": client_request_id})`, and the front end never has to know what MLflow is.

The second suits an app that already has a request id. Either way the feedback endpoint calls `mlflow.log_feedback()` with a boolean, `True` for thumbs up. In production install `mlflow-tracing` rather than the full package; MLflow 2 is not supported for this at all.

## Example: a chat endpoint and a feedback endpoint

```python
import mlflow
from fastapi import FastAPI
from mlflow.entities import AssessmentSource
from pydantic import BaseModel

mlflow.set_tracking_uri("databricks")
mlflow.set_experiment("/Shared/support-assistant")
mlflow.openai.autolog()

app = FastAPI()

class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    response: str
    trace_id: str

class FeedbackRequest(BaseModel):
    trace_id: str
    is_correct: bool          # True for thumbs up, False for thumbs down
    comment: str | None = None
    user_id: str

@app.post("/chat", response_model=ChatResponse)
@mlflow.trace(name="support_assistant")
def chat(request: ChatRequest) -> ChatResponse:
    answer = support_assistant(request.message)
    # hand the id back so the browser can attach feedback to this exact call
    return ChatResponse(response=answer, trace_id=mlflow.get_current_active_span().trace_id)

@app.post("/feedback")
def feedback(request: FeedbackRequest):
    mlflow.log_feedback(
        trace_id=request.trace_id,
        name="user_feedback",
        value=request.is_correct,
        source=AssessmentSource(source_type="HUMAN", source_id=request.user_id),
        rationale=request.comment,
    )
    return {"status": "ok"}
```

The thumbs-down traces are now findable, and they are the first candidates for a review queue: an expert reads what the application said, records what it should have said, and that expectation syncs into the dataset the next evaluation run scores against. The whole loop starts with one boolean.

## Common mistakes

- **A thumbs-down button with nothing to attach it to.** If the response carries no trace id or `client_request_id`, the feedback is a count with no example behind it, and you cannot reconstruct which answer annoyed the user.
- **Creating workspace users for reviewers.** They need an account identity, provisioned with account-level SCIM, and nothing more. Buying workspace seats for a dozen experts is the wrong fix to a permissions error.
- **Confusing feedback with an expectation.** A rating tells you this one answer was bad; only an expectation can be scored against on the next run. Design the questions so the expert is asked for both.
- **Asking only "was this good?"** Without `enable_comment` or a rationale you end up with a percentage and no diagnosis. The comment is where the expert says which sentence was wrong.
- **Collecting expert labels and never syncing them.** A session never synced into an [[evaluation-datasets|evaluation dataset]] is a spreadsheet with extra steps.

> [!exam]
> The Generative AI Engineer Associate guide asks you to incorporate SME feedback to improve agent performance, so know the mechanism, not just the idea: human judgement is an **assessment** on a trace, split into **feedback** (a verdict on the output) and an **expectation** (ground truth), and it is the expectation that feeds a judge such as Correctness. Know that experts need an account identity rather than workspace access, that review queues and labelling sessions route work to named reviewers, and that end-user thumbs up and down reach MLflow through `mlflow.log_feedback()` keyed on a trace id. The distinction that catches people: feedback measures one answer, an expectation becomes a permanent test.
