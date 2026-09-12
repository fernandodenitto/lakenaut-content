---
id: genie-conversation-api
title: "Using Genie outside the UI: API, embedding and agents"
area: genie
level: advanced
summary: The Conversation API, embedding, Slack and Teams, MCP and the Supervisor Agent let a Genie Agent answer from anywhere, always as an identity whose permissions apply.
prerequisites: [genie-agents]
related: [genie-benchmarks-monitoring, agent-framework, cli-and-sdk, bundles-overview]
exams:
  - cert: genai-engineer-associate
    domain: "Application Development"
    objective: "Enable multi-agent systems to leverage Genie Spaces or the conversational API to retrieve data"
  - cert: data-analyst-associate
    domain: "Developing, Sharing, and Maintaining AI/BI Genie spaces"
    objective: "Assign permissions via the UI and distribute Genie spaces using embedded links and external app integrations."
sources:
  - url: https://docs.databricks.com/aws/en/genie-agents/conversation-api
    checked: 2026-09-11
  - url: https://docs.databricks.com/api/genie/v1/conversation
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/genie-agents/embed
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/genie-one/genie-slack
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/generative-ai/mcp/managed-mcp
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/generative-ai/agent-bricks/multi-agent-supervisor
    checked: 2026-09-11
aliases: [genie api, genie conversation api, conversational api, genie mcp, genie embed, genie slack, genie teams, supervisor agent genie]
updated: 2026-09-11
status: published
---

## What it is

A [[genie-agents|Genie Agent]] is not tied to its own chat window. The same agent can answer from:

- an **iframe** embedded in an internal portal;
- **Genie One**, **Slack** or **Microsoft Teams**;
- the **Conversation API**, from any application or script;
- a **managed MCP server**, from an agent that speaks the Model Context Protocol;
- a **Supervisor Agent** (Agent Bricks), as one sub-agent among several.

Whatever the surface, a question is always asked by an identity, and that identity's Unity Catalog permissions decide what data comes back.

## Why it exists

Business users live in chat tools and portals, not in the Databricks UI, and engineers building assistants need structured data answers without writing their own text-to-SQL. Reusing a curated Genie Agent means the business definitions, trusted assets and benchmarks the data team maintains (see [[genie-knowledge-store]]) are the same ones every surface uses.

## How it works

### The Conversation API

The API is generally available. It still uses the old name in its paths, so `space_id` is the agent's id:

| Call | Path |
| --- | --- |
| Start a conversation | `POST /api/2.0/genie/spaces/{space_id}/start-conversation` |
| Ask a follow-up | `POST .../conversations/{conversation_id}/messages` |
| Poll a message | `GET .../conversations/{conversation_id}/messages/{message_id}` |
| Fetch the SQL result | `GET .../messages/{message_id}/attachments/{attachment_id}/query-result` |
| Re-run an expired result | `POST .../attachments/{attachment_id}/execute-query` |
| Send feedback | `POST .../messages/{message_id}/feedback` |

The flow is asynchronous: start, **poll** until the message is `COMPLETED`, `FAILED` or `CANCELLED`, then read the attachments (text and query results). Poll every one to five seconds with exponential backoff up to a minute, and give up after about ten minutes. Start a new conversation per user session, send follow-ups to the same conversation to keep context, and delete old ones: an agent keeps at most 200,000 conversations.

**Agent mode** has its own streaming endpoint, `POST /api/2.0/genie/agents/{agent_id}/responses`, which returns server-sent events up to a 30-minute timeout.

### Authentication and permissions

Use OAuth: **user-to-machine** when a person is behind the call (their permissions apply, exactly as in the UI), **machine-to-machine** with a service principal for back-end jobs. A service principal needs the Databricks SQL entitlement, `CAN USE` on a pro or serverless warehouse, `CAN RUN` on the agent and `SELECT` on the data, and everything it asks is answered with its permissions, not the end user's. That is the main design decision: a shared service principal is simple, but it flattens row-level security.

### Embedding, Genie One, Slack and Teams

- **Embedding**: an admin first allows the embedding surface; a user with `CAN MANAGE` copies the iframe code. Viewers still sign in and need access to the agent and its data; they can ask but not edit.
- **Genie One** lists agents next to dashboards and apps, and its chat routes each question to a matching agent.
- **Slack and Teams apps** (Public Preview, enabled by an account admin) answer through Genie One, or through one specific agent pinned to a channel. Users sign in with their Databricks identity.

### Genie as a tool for other agents

- A **managed MCP server** exposes one agent at `/api/2.0/mcp/genie/{genie_space_id}` (read-only). It passes no conversation history, so each tool call is a standalone question.
- A **Supervisor Agent** (formerly Multi-Agent Supervisor) can list a Genie Agent as a sub-agent, next to a Knowledge Assistant for documents or Unity Catalog functions. The supervisor sends data questions to Genie and document questions elsewhere, and end users still need access to the agent and the underlying tables.
- A custom agent built with the [[agent-framework]] can call the Conversation API directly, or declare the agent as a resource (`genie_space`) so the serving endpoint gets the right permissions.

### Managing agents as code

The management API creates an agent from a serialized definition, and bundles deploy one with the `genie_spaces` resource (see [[bundles-overview]]), so an agent can move from dev to prod with its instructions and benchmarks, the same way a job does.

## Example

Asking a question with the Python SDK and reading the result:

```python
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()                       # OAuth from the environment
SPACE_ID = "01f0c3a2b1d94e5f8a7b6c5d4e3f2a10"  # the Genie Agent id

msg = w.genie.start_conversation_and_wait(
    space_id=SPACE_ID,
    content="Net revenue by region for last month",
)
for att in msg.attachments or []:
    if att.query:
        print(att.query.query)              # the generated, read-only SQL
        res = w.genie.get_message_attachment_query_result(
            space_id=SPACE_ID,
            conversation_id=msg.conversation_id,
            message_id=msg.id,
            attachment_id=att.attachment_id,
        )
        print(res.statement_response.result.data_array[:5])
    elif att.text:
        print(att.text.content)
```

## Common mistakes

- Using one service principal for a customer-facing app and assuming row filters still apply per end user. They apply to the service principal.
- Polling in a tight loop, or never timing out.
- Reusing one conversation for every user, which mixes context and hits the conversation limits.
- Wiring an agent into a supervisor or MCP client before it passes its benchmarks, so errors surface in someone else's product.
- Looking for "agents" in the API paths: the chat API still says `spaces`.

> [!exam]
> For the GenAI Engineer exam: a multi-agent system gets **governed structured data** by adding a Genie space (now Genie Agent) as a sub-agent of a supervisor, or by calling the **Conversation API**; unstructured documents go to a retrieval agent instead. For the Data Analyst exam: distribution means the share dialog, **embedded links** and **external apps** such as Slack and Teams, with each viewer's own permissions applied.
