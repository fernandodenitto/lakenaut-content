---
id: ai-playground
title: AI Playground
area: playground
level: beginner
summary: AI Playground is a chat UI in the workspace for trying foundation models, comparing them side by side, and prototyping tool-calling agents without writing code.
prerequisites: [platform-architecture, unity-catalog-overview]
related: [foundation-model-apis, ai-gateway-basics, mlflow-tracking, agent-framework]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/large-language-models/ai-playground
    checked: 2026-09-10
aliases: [playground, ai playground, prompt playground]
updated: 2026-09-10
status: published
---

## What it is

**AI Playground** is a chat window built into the workspace, under the AI/ML section of the left sidebar. You pick a model from a dropdown, type a message, and get a response — no notebook, no cluster, no code. It is the fastest way to see how a model behaves before wiring it into anything.

## Why it exists

Choosing a model, writing a system prompt, and deciding whether an agent needs tools are all things you want to iterate on quickly, by eye, before you commit to code that has to be maintained. Playground gives every workspace user — not just people comfortable in a notebook — a place to do that exploration, and it gives engineers a fast inner loop for prototyping before they touch [[agent-framework]] or a real deployment.

## How it works

### Chatting and comparing models

You select an endpoint — a Databricks-hosted foundation model, an external model, or your own custom serving endpoint — and start typing, optionally from a list of sample prompts. Clicking **+** adds a second endpoint alongside the first: the same message goes to both, and their answers appear in parallel columns, which is the quickest way to decide between two models or two versions of a prompt without switching tabs.

### System prompt and parameters

A side panel exposes the system prompt and generation parameters such as temperature and max tokens. Changing them updates the next turn immediately, so you can tune tone and verbosity interactively instead of guessing at values in code.

### Tool calling and Unity Catalog functions

Playground can attach **tools** to a conversation, most commonly functions registered in [[unity-catalog-overview]] as SQL or Python UC functions. Once attached, the model decides when a user's question needs a tool, calls it, and the UI shows the call and its result inline before the model uses that result to answer. This is exactly how a production agent behaves later; Playground just lets you watch the decision happen turn by turn. A UC function used this way needs a clear `COMMENT` on the function and its parameters — that comment is the only description the model gets of what the tool does.

### Exporting to notebook code

An **Export** action turns the current setup — model, system prompt, parameters, and attached tools — into a driver notebook that reproduces the same behavior in Python. That notebook is the bridge from prototype to something you can version, schedule, or extend with [[agent-framework]] code.

### Tracing with MLflow

Turns that involve tool calls are captured as traces in an MLflow experiment (see [[mlflow-tracking]]): each model call and each tool invocation is logged with its inputs, outputs, and latency, so a confusing answer can be debugged by looking at exactly what the model chose to call, not just what it finally said.

### What it is not

Playground has no stable URL for an application to call, no SLA, and no concept of concurrent external traffic — it is a workspace UI for one person at a time. Anything meant to serve real users moves to a governed path: called through [[foundation-model-apis]] or a custom endpoint ([[model-serving-endpoints]]), and ideally sitting behind [[ai-gateway-basics]] once more than one team depends on it.

## Example

A minimal UC function you could attach as a Playground tool:

```sql
CREATE OR REPLACE FUNCTION main.tools.order_status(order_id STRING COMMENT 'The order identifier, e.g. ORD-10432')
RETURNS STRING
COMMENT 'Look up the current fulfillment status of a customer order by id.'
RETURN (
  SELECT status FROM main.sales.orders WHERE id = order_id
);
```

With this function attached, asking "where is order ORD-10432" makes the model call it and read the result back to the user, instead of guessing.

## Common mistakes

- Treating a good Playground session as done: nothing persists automatically, and the session disappears if you don't export it.
- Leaving a UC function without a useful `COMMENT`, so the model can't tell when the tool applies and either ignores it or calls it on the wrong questions.
- Comparing two models side by side with different system prompts or parameters, which makes the comparison meaningless.
- Assuming Playground itself can be called from an application — it can't; export first, then deploy.

> [!tip]
> Use Playground as the design surface for the *prompt and the tool contract*, not just the model choice. By the time you export, the UC function comments and the system prompt you settled on are most of what a real agent needs.
