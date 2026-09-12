---
id: mcp-on-databricks
title: Model Context Protocol on Databricks
area: agents
level: advanced
summary: "Three places an agent's MCP servers come from: Databricks-managed servers, external servers registered in Unity Catalog as MCP Services, and custom servers hosted as apps."
prerequisites: [agent-tools-uc-functions, unity-catalog-overview]
related: [agent-deployment-apps, agent-tools-uc-functions, ai-gateway-basics, genie-agents, ai-search-indexes]
exams:
  - cert: genai-engineer-associate
    domain: "Assembling and Deploying Applications"
    objective: "Integrate managed, external, and custom MCP servers based on given application requirements"
sources:
  - url: https://docs.databricks.com/aws/en/agents/mcp-tools/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/agents/mcp-tools/managed-mcp
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/agents/mcp-tools/mcp-services
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/agents/mcp-tools/built-in-mcp-services
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/agents/mcp-tools/custom-mcp
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/agents/mcp-tools/use-mcp-in-agents
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/agents/mcp-tools/connect-external
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/agents/custom-agents/agent-authentication
    checked: 2026-09-12
aliases: [mcp, model context protocol, managed mcp, mcp services, custom mcp server, databricks-mcp, DatabricksMCPClient, on-behalf-of-user, system.ai services, unity gateway mcp]
updated: 2026-09-12
status: published
maturity: public-preview
maturity_checked: 2026-09-12
---

> [!note]
> Maturity here is not uniform. As of September 2026 **Databricks-managed MCP servers** and **using MCP servers from agent code** both carry a Public Preview banner. **MCP Services** and **hosting your own server as an app** carry none, except that three built-in workspace services (`system.ai.dbsql`, `system.ai.web_search`, `system.ai.sandbox`) are in Beta. Check the specific page before committing a design to it.

## What it is

The **Model Context Protocol** is an open standard for connecting an agent to tools, resources and prompts. On Databricks it is the documented default way to give an agent capabilities, and a server comes from one of exactly three places:

| Source | What it is | URL shape |
| --- | --- | --- |
| **Managed** | servers Databricks hosts for Genie, AI Search, SQL and Unity Catalog functions | `https://<host>/api/2.0/mcp/<service>/<path>` |
| **MCP Service** | an external or built-in server registered as a Unity Catalog securable | `https://<host>/ai-gateway/mcp-services/<catalog>.<schema>.<service>` |
| **Custom** | your own server, hosted as a Databricks app | `https://<app-url>/mcp` |

All three speak the same protocol, so the agent code is identical and only the URL and the authentication differ. [[ai-gateway-basics|Unity Gateway]] is the control plane in front of all of them, Unity Catalog enforces the permissions, and the servers available to you are listed under **AI Gateway** then **MCPs**. [[agent-tools-uc-functions]] covers what a single tool is and how the catalog governs it; this page is about the protocol and the servers.

## Why it exists

Before a wire protocol existed, every combination of framework and tool source needed its own adapter. LangChain wanted tool objects, the OpenAI SDK wanted function specs, and each external service arrived with its own SDK, its own token handling and its own idea of what a tool description is. Adding Slack meant writing a Slack client, storing a Slack token, and writing the schema twice.

MCP collapses that into one interface, and Databricks adds what the standard leaves out: where credentials live and who may call what. An MCP Service is a catalog object with an owner, grants, a tool allowlist, an optional policy and an audit trail, so "which external systems can this agent touch" becomes a query rather than a code review.

## How it works

### Databricks-managed servers

Nothing to host and nothing to authenticate by hand. When you reach one with on-behalf-of-user authentication, include the matching OAuth scope.

| Server | Use case | URL pattern | Scope |
| --- | --- | --- | --- |
| Genie One | natural-language analytics across the workspace | `/api/2.0/mcp/genie` | `genie` |
| Genie Agent | analytics scoped to one Genie Agent | `/api/2.0/mcp/genie/{genie_space_id}` | `genie` |
| AI Search | retrieval over unstructured documents | `/api/2.0/mcp/ai-search/{catalog}/{schema}/{index_name}` | `ai-search` |
| Databricks SQL | developer queries and data engineering | `/api/2.0/mcp/sql` | `sql` |
| Unity Catalog functions | predefined SQL and Python logic as tools | `/api/2.0/mcp/functions/{catalog}/{schema}/{function_name}` | `unity-catalog` |

The `system.ai` schema already holds usable functions, including the code interpreter `system.ai.python_exec`, reached through the Unity Catalog functions server. For analytics, start with **Genie One** rather than the SQL server: Genie resolves business terms through the ontology you already maintain (see [[genie-ontology]]) instead of letting the model write SQL against raw tables. The SQL server is for running a query you already wrote.

Parameters arrive two ways: ordinary **tool call arguments**, which the model fills in from the request, and **`_meta` parameters**, documented per server, which you preset in agent code to pin behaviour.

### MCP Services: external servers as catalog objects

An MCP Service is a Unity Catalog securable with a three-level name, invoked through its Unity Gateway URL. Every call takes the same path: the gateway checks `EXECUTE`, applies the tool selection and any attached service policy (allow, deny, or require approval), runs the tool with the caller's identity or a managed credential, and records the invocation in system tables.

Databricks ships built-in services in `system.ai`. The workspace tools are `system.ai.dbsql`, `system.ai.web_search` and `system.ai.sandbox`, all three in Beta. The connected applications are `system.ai.slack`, `system.ai.github`, `system.ai.atlassian` (Jira and Confluence), `system.ai.google_drive`, `system.ai.google_calendar`, `system.ai.gmail` and `system.ai.microsoft_365`. Anything else you register yourself over a Unity Catalog HTTP connection, and Databricks manages the OAuth flow and token refresh so users never handle a token.

Two limits shape what you can plan: there is no SQL DDL for MCP Services, so they are created through the UI or the REST API, and tool selection accepts prefix (`get_*`) and exact matches only, with no exclusion patterns such as `!delete_*`.

### Hosting your own server as an app

A custom server is a Databricks app implementing an HTTP-compatible transport, typically streamable HTTP, answering at `https://<app-url>/mcp`, governed by app permissions rather than catalog grants. The **MCP Server - Hello World** template under the **Agents** category is the quickest start; you add tools with the `@mcp.tool()` decorator, and each needs a docstring, because that is what the agent reads when deciding to call it. Name the app with an `mcp-` prefix: the AI Playground recognises MCP servers by it.

### Authenticating on behalf of a user

Three modes: a local CLI profile while you develop, a service principal's OAuth credentials for shared access, and **on-behalf-of-user** when the agent should reach only what the caller could reach. On an app (see [[agent-deployment-apps]]) the last one means declaring the scopes under `user_api_scopes`, adding `ai-gateway` for an MCP Service, and building the client with `get_user_workspace_client()` inside the request handler.

Three things trip it up, in order. The **calling user** needs `EXECUTE` on the service plus `USE CATALOG` and `USE SCHEMA` on its parents, not just the app's service principal, though account users usually hold these already on `system.ai`. That `EXECUTE` **cannot be granted through a bundle**, because a `uc_securable` resource covers only volumes, tables, functions and connections, and `databricks bundle validate` says nothing, so the app deploys cleanly and fails on its first tool call. And each user completes a **one-time OAuth login**; until they do, the call returns JSON-RPC error `-32042` with a login URL in `error.data.elicitations[]` that your app is expected to show them.

For an external server, the connection chooses between **shared principal** authentication (bearer token, OAuth M2M, or a shared user-to-machine grant) and **per-user OAuth**, and per-user is what anything reading one person's calendar, mail or repositories needs. Either way the agent never reaches the server directly: Unity Gateway attaches the credential and calls out through your serverless compute plane, so under restricted egress control the server's domain has to be in the network policy's allowed list.

## Example: listing and calling tools across two server types

The `databricks-mcp` package handles authentication for all three server types, so one client works everywhere. Discover tools at runtime rather than hardcoding names. Tool names flatten the catalog path, so `main.support_tools.order_status` is called as `main__support_tools__order_status`.

```python
from databricks.sdk import WorkspaceClient
from databricks_mcp import DatabricksMCPClient

workspace_client = WorkspaceClient(profile="DEFAULT")
host = workspace_client.config.host

# Managed server: every Unity Catalog function in one schema.
functions = DatabricksMCPClient(
    server_url=f"{host}/api/2.0/mcp/functions/main/support_tools",
    workspace_client=workspace_client,
)
print([t.name for t in functions.list_tools()])
# ['main__support_tools__order_status', 'main__support_tools__refund_window_days']

result = functions.call_tool(
    "main__support_tools__order_status", {"order_ref": "ORD-44812"}
)
print(result.content)

# MCP Service: a built-in SaaS server, addressed by its three-level name.
github = DatabricksMCPClient(
    server_url=f"{host}/ai-gateway/mcp-services/system.ai.github",
    workspace_client=workspace_client,
)
print([t.name for t in github.list_tools()])
```

The resources behind a managed server are declared on the app that calls it, under `resources.apps.<app>.resources` in `databricks.yml`, alongside the `user_api_scopes` the servers need. An MCP Service is the exception: its `EXECUTE` has to be granted separately.

## Common mistakes

- **Hardcoding tool names and argument shapes.** They come from the server, they differ per service, and `list_tools()` is the only reliable source. A managed server's names also change when you widen or narrow the catalog path.
- **Granting the app's service principal and forgetting the user.** With on-behalf-of-user authentication the _caller_ needs `EXECUTE` plus `USE CATALOG` and `USE SCHEMA`. Grant only the service principal and every real user gets a not-found.
- **Expecting the bundle to grant an MCP Service.** It cannot, `validate` stays silent, and the failure surfaces as a runtime tool error. Grant it through Catalog Explorer or the permissions REST API.
- **Not surfacing the login link.** The first per-user call to a service such as `system.ai.gmail` fails with `-32042` by design. Swallow that error and the feature looks broken rather than unauthorised.
- **Reaching for the Databricks SQL server for business questions.** It is right for a query you already wrote. For "revenue by channel last month", Genie One and a governed semantic layer answer better.
- **Treating managed servers as settled.** They are in Public Preview: fine for a prototype, a risk to hang a release date on.

> [!exam]
> The Generative AI Engineer Associate guide asks you to "integrate managed, external, and custom MCP servers based on given application requirements", so know the three-way split cold: **managed** servers for Genie, AI Search, Databricks SQL and Unity Catalog functions, with nothing to host; **external** servers registered as MCP Services and addressed by a three-level Unity Catalog name; **custom** servers hosted as a Databricks app with an `mcp-` name prefix. The permission on an MCP Service is `EXECUTE` plus `USE CATALOG` and `USE SCHEMA`, and on-behalf-of-user access also needs an OAuth scope (`genie`, `ai-search`, `sql`, `unity-catalog`, or `ai-gateway`).
