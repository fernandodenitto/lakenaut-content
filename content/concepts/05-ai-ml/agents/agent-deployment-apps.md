---
id: agent-deployment-apps
title: Deploy an agent on Databricks Apps
area: agents
level: advanced
summary: "The documented way to ship a custom agent: the MLflow ResponsesAgent interface, an AgentServer inside a Databricks App, a bundle to deploy it, and Model Serving as the legacy path."
prerequisites: [agent-framework, bundles-overview]
related: [agent-tools-uc-functions, mcp-on-databricks, agent-evaluation, mlflow-tracing, model-serving-endpoints]
exams:
  - cert: genai-engineer-associate
    domain: "Assembling and Deploying Applications"
    objective: "Develop an appropriate interactive user-facing interface for an agent usage scenario (Apps, Slack, Teams, etc.)"
sources:
  - url: https://docs.databricks.com/aws/en/agents/custom-agents/author-agent
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/agents/custom-agents/productionize-agent
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/agents/custom-agents/migrate-agent-to-apps
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/agents/custom-agents/agent-authentication
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/agents/custom-agents/chat-app
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/agents/custom-agents/model-serving/author-agent-model-serving
    checked: 2026-09-12
aliases: [databricks apps agent, agentserver, responsesagent, invoke, stream, agent template, app-templates, agent deployment, custom agents]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

Databricks documents one way to ship a custom agent: write it as an ordinary Python project, then run that project as a **Databricks App**. Two pieces are fixed and the rest is yours.

The **interface** is MLflow's `ResponsesAgent`. Its request and response objects follow the OpenAI Responses schema, and implementing it is what buys you compatibility with the AI Playground, evaluation and monitoring, plus streaming, multi-turn tool-call history and multi-agent handoffs. The **server** is MLflow's `AgentServer`, an async FastAPI application that exposes the agent at `/responses` and handles request routing, logging, error propagation and tracing.

Everything else is a normal repository: `pyproject.toml`, `uv.lock`, your modules, your routes, and a `databricks.yml` that declares the app and every resource it touches. You ship it with `databricks bundle deploy` followed by `databricks bundle run`.

Deploying an agent behind a Model Serving endpoint is the **legacy path**. It still works and is still documented, but those pages now live in a separate "Custom Agent on Model Serving" section and each one opens by directing new work to Apps. There is a migration guide for existing endpoints. [[agent-framework]] covers the platform-level shape of an agent; this page is about where it runs.

## Why it exists

On Model Serving, the agent was a logged MLflow model. Every code change meant logging a new version, registering it and waiting for an endpoint update, so the edit-to-answer loop was minutes long and there was no way to attach a debugger. The resources the agent was allowed to reach were declared in the `MLmodel` file, which meant permissions were a property of an artifact rather than of a deployment.

Running the agent as an app inverts all of that. The deployment is seconds, the same code runs on your laptop, the code is versioned in Git and promoted by a bundle target, the resources are declared in `databricks.yml` where the rest of your infrastructure lives, and you can use `async def` to hold hundreds of concurrent requests while each waits on a model. You also get to add middleware, extra routes and a front end, because it is your server.

## How it works

### From a class to two functions

On Model Serving an agent was a subclass of `ResponsesAgent` with `predict()` and `predict_stream()`. On Apps the `AgentServer` serves **module-level functions** decorated with `@invoke()` and `@stream()` from `mlflow.genai.agent_server`. The async form is the recommended one, and the usual arrangement is that `@stream()` holds the real logic while `@invoke()` collects its `response.output_item.done` events into a single response.

The older `ChatAgent` interface is still supported, but the documentation points new agents at `ResponsesAgent`.

### The frameworks the docs demonstrate

Two, and the choice is not load-bearing. The tutorial template uses the **OpenAI Agents SDK** with its `@function_tool` decorator; the alternative shown throughout is **LangGraph** with LangChain's `@tool`, `create_react_agent` and `ChatDatabricks`. Any framework works, because what the platform reads is the `ResponsesAgent` shape, not the library underneath. Tools defined as local Python functions run in the agent process and need no grants; anything that reaches data comes in as an MCP server or a Unity Catalog function (see [[mcp-on-databricks]] and [[agent-tools-uc-functions]]).

Start from a template in `databricks/app-templates` rather than wiring `AgentServer` by hand: `agent-openai-agents-sdk`, `agent-langgraph`, and `agent-migration-from-model-serving` for the migration. Each ships `AGENTS.md` and skill files so a coding assistant can work in the project.

### The built-in chat interface

Every conversational template pulls in the chat app template as its front end and bundles it into the same deployment, so there is nothing to set up. It streams, renders markdown, and identifies the end user through Databricks authentication. Two options are off by default: **persistent chat history**, which stores conversations in a Lakebase Postgres instance instead of in memory, and **thumbs up or down feedback**, which is logged to the MLflow experiment the bundle already configures.

### Authentication and resources

Two modes, and you can mix them. **App authorization** uses the service principal Databricks creates for the app, so every user shares its permissions. **User authorization** forwards the caller's identity, which is what you want for per-user access control and audit trails: declare the scopes under `user_api_scopes` (for example `sql`, `genie`, `model-serving`, `ai-gateway`) and call `get_user_workspace_client()` **inside** an `@invoke` or `@stream` function, never at startup, because user credentials only exist while a request is being handled.

Resources go under `resources.apps.<app>.resources` in `databricks.yml`, and deploying the bundle grants them. The mapping from the old `MLmodel` declarations is worth keeping to hand:

| `MLmodel` resource | `databricks.yml` equivalent | Permission |
| --- | --- | --- |
| `serving_endpoint` | `serving_endpoint` | `CAN_QUERY` |
| `function` | `uc_securable`, type `FUNCTION` | `EXECUTE` |
| `table`, `vector_search_index` | `uc_securable`, type `TABLE` | `SELECT` or `MODIFY` |
| `uc_connection` | `uc_securable`, type `CONNECTION` | `USE_CONNECTION` |
| `sql_warehouse` | `sql_warehouse` | `CAN_USE` |
| `genie_space` | `genie_space` | `CAN_RUN` |
| `lakebase` | `database` | `CAN_CONNECT_AND_CREATE` |

### Productionising it

The documentation gives an order, and it is a sensible one. First **CI/CD**: a GitHub Actions workflow ships with the templates and uses workload identity federation, so there is no long-lived secret (see [[bundles-ci-cd]]). Then a **load test**: run a ramp-to-saturation test against a mock-LLM build of the agent, which isolates the throughput of the app infrastructure from model latency and tells you the maximum QPS the agent sustains. Then **governance**: route the agent's model calls through Unity Gateway by passing the gateway endpoint name as `model` and setting `use_ai_gateway=True` on the Databricks client, which centralises permissions, attributes cost per app and lets you swap models without touching agent code (see [[ai-gateway-basics]]).

## Example: a LangGraph agent served from an app

The agent itself, in `agent_server/agent.py`:

```python
from typing import AsyncGenerator

from databricks_langchain import ChatDatabricks
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
)


@tool
def refund_window_days(purchased_on: str) -> int:
    """Days left in the refund window for a purchase date in ISO format."""
    from datetime import date

    return max(0, 30 - (date.today() - date.fromisoformat(purchased_on)).days)


graph = create_react_agent(
    ChatDatabricks(endpoint="databricks-claude-sonnet-4-5"),
    tools=[refund_window_days],
)


@stream()
async def streaming(request: ResponsesAgentRequest) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    async for event in graph.astream(
        {"messages": [m.model_dump() for m in request.input]}, stream_mode="messages"
    ):
        yield ResponsesAgentStreamEvent(**event)


@invoke()
async def non_streaming(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    # Collect the stream's finished items into one response.
    output = [e.item async for e in streaming(request) if e.type == "response.output_item.done"]
    return ResponsesAgentResponse(output=output)
```

The app and its grants, in `databricks.yml`. The name has to start with `agent-` or the app will not appear in the workspace **Agents** list:

```yaml
resources:
  apps:
    agent_refunds:
      name: 'agent-refunds'
      source_code_path: ./
      user_api_scopes:
        - model-serving
      config:
        command: ['uv', 'run', 'start-app']
        env:
          - name: MLFLOW_TRACKING_URI
            value: 'databricks'
          - name: MLFLOW_EXPERIMENT_ID
            value_from: 'experiment'
      resources:
        - name: 'experiment'
          experiment:
            experiment_id: '<experiment-id>'
            permission: 'CAN_EDIT'
        - name: 'llm'
          serving_endpoint:
            name: 'databricks-claude-sonnet-4-5'
            permission: 'CAN_QUERY'
```

Run it locally, then ship it:

```bash
uv run quickstart          # dependencies, auth, MLflow experiment, .env
uv run start-app           # chat UI on http://localhost:8000
databricks bundle validate
databricks bundle deploy   # uploads code and configures resources
databricks bundle run agent_refunds   # starts or restarts the app
```

## Common mistakes

- **Running `bundle deploy` and stopping there.** Deploy uploads files and configures resources; it does not start the app with the new code. `bundle run` does, and it is a separate step on every redeploy.
- **Calling `get_user_workspace_client()` at app startup.** The user's credentials only exist while a request is in flight, so it has to be called inside `@invoke` or `@stream`.
- **Naming the app anything other than `agent-something`.** It deploys fine and then never shows up in the **Agents** list, which reads as a broken deployment.
- **Provisioning small compute.** Only medium and large compute sizes are supported for agent apps.
- **Querying it with a personal access token.** PATs are not supported for Databricks Apps; generate an OAuth token with `databricks auth token`.
- **Keeping a `requirements.txt` in the project.** If one is present it always wins and the app installs with pip; the reproducible path is `pyproject.toml` plus a committed `uv.lock`.
- **Planning on the MLflow review app.** Its chat UI does not yet support agents deployed on Apps. Use labelling sessions over existing traces, or the feedback widget in the chat template.

> [!exam]
> The Generative AI Engineer Associate guide asks you to "develop an appropriate interactive user-facing interface for an agent usage scenario (Apps, Slack, Teams, etc.)" and, separately, to use MLflow and agent tooling to build agentic systems. Know that the interface to implement is **`ResponsesAgent`** and not the older `ChatAgent`, that the server is MLflow's `AgentServer` with `@invoke()` and `@stream()`, and that deployment is a Declarative Automation Bundle (`validate`, `deploy`, `run`) rather than `agents.deploy()`. The distinction that catches people out: resources and permissions are declared in `databricks.yml` for an app, in the `MLmodel` file for the legacy Model Serving path.
