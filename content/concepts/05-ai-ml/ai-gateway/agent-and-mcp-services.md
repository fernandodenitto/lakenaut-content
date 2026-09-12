---
id: agent-and-mcp-services
title: Agent and MCP services as Unity Catalog securables
area: ai-gateway
level: advanced
summary: Registering agents and MCP servers as Unity Catalog objects, so every team's agents are discoverable in one place and every tool a server exposes is chosen, policed and counted.
prerequisites: [model-services, mcp-on-databricks]
related: [ai-gateway-basics, agent-tools-uc-functions, privileges-grant-revoke, system-tables, agent-deployment-apps]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/ai-gateway/agent-services
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/ai-gateway/register-mcp-service
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/ai-gateway/govern-mcp-service
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/ai-gateway/rate-limits
    checked: 2026-09-12
aliases: [agent service, agent services, agent registry, mcp service, mcp services, register mcp server, include_tool_selectors, tool selectors, mcpCall, agent governance]
updated: 2026-09-12
status: published
maturity: beta
maturity_checked: 2026-09-12
---

> [!note]
> Maturity here is not uniform. As of September 2026 **agent services** are Beta and cannot yet be invoked at runtime, and **service policies** are Beta. **Registering an MCP server as an MCP Service** carries no preview banner, nor do its rate limits. Unity Gateway itself is generally available and its Beta capabilities are enabled separately, by an account admin, from the **Previews** page.

## What it is

[[model-services]] made an LLM endpoint a Unity Catalog object. The same idea now covers the two other things an agent is made of:

- an **agent service** registers an agent itself under a three-level name, so a team's agents sit in Catalog Explorer next to the tables, models and functions they use, under the same grants;
- an **MCP service** registers an MCP server under a three-level name, with a chosen subset of its tools, an owner, grants, policies, rate limits and a row per call in the system tables.

[[mcp-on-databricks]] covers the protocol: where a server comes from, how an agent discovers tools, how on-behalf-of-user authentication works. This page is the registration, which is a governance act rather than a protocol one.

## Why it exists

Ask a platform team how many agents their organisation is running and the honest answer is a guess. Agents get built in notebooks, deployed as apps and wired to endpoints, and none of that leaves a record where governance already looks. There is no equivalent of `SHOW TABLES` for agents, which means no owner, no review, and no way to find the one somebody left running when they changed team. An agent service is not compute: it is the catalog entry that turns that question into a query.

The MCP half solves a sharper problem. A server is a set of tools, and a set of tools is a set of side effects. A GitHub server that exposes `get_issue` also exposes whatever it has for closing and deleting things, and handing an agent the server hands it all of them. Registering the server lets you expose a named subset, police what survives, cap how often it runs, and read back who called what.

## How it works

### Registering an agent

An agent service lives at `catalog.schema.agent_service_id` and is created through the REST API. There is no UI flow and no SQL DDL for it.

```bash
databricks api post \
  "/api/2.1/unity-catalog/agent-services?parent=schemas/main.default&agent_service_id=support_agent" \
  --json '{
    "agent_service_type": "AGENT_SERVICE_TYPE_EXTERNAL",
    "comment": "Support agent for the customer team",
    "config": {
      "source_connection": {"name": "connections/main.default.my_agent_connection"},
      "base_path": "/v1/chat",
      "system_prompt": "You are a helpful support assistant."
    }
  }'
```

`AGENT_SERVICE_TYPE_EXTERNAL` is the only type so far. Creating one needs `USE CATALOG`, `USE SCHEMA`, `CREATE SERVICE` and `USE CONNECTION`; the privileges you hand out afterwards are `EXECUTE`, `READ METADATA`, `MANAGE` and `ALL PRIVILEGES`. The rest of the surface is a `GET` on the full name, a `GET` on the parent schema to list, a `PATCH` with an `update_mask` such as `config.system_prompt`, and a `DELETE`.

### What the agent registry cannot do yet

The Beta limitations are large enough to plan around rather than work around:

| Limitation | Consequence |
| --- | --- |
| Runtime invocation is not available | an agent cannot be called through its agent service |
| No service policies, no rate limits | the controls a model service gets do not apply here |
| No SQL DDL | REST API only, so no `GRANT` script covers it |
| `full_name` and `owner` come back null | tooling keyed on those fields needs care |
| Global Search does not surface them | you find them in Catalog Explorer, not the search box |
| `BROWSE` is unsupported | discovery needs `EXECUTE` or `READ METADATA` |

An agent service is therefore an inventory entry with permissions attached, not a front door. That is still the thing nobody has.

### Registering an MCP server

Two objects, in order. First a schema-level **connection** holding the server's endpoint and credentials: bearer token, OAuth M2M, OAuth U2M, dynamic client registration, or managed OAuth for the providers Databricks handles itself (Glean, GitHub, Atlassian, Slack). Then the service on top of it.

```bash
databricks api post \
  "/api/2.1/unity-catalog/mcp-services?parent=schemas/main.default&mcp_service_id=github_readonly" \
  --json '{
    "comment": "GitHub, read-only tools for the support agent",
    "config": {
      "source_connection": {"name": "connections/main.default.github_conn"},
      "include_tool_selectors": ["get_*", "search_repositories"]
    }
  }'
```

The same thing exists in the UI under **AI Gateway** then **MCPs** then **Register MCP Server**, or from **Catalog** then **Create** then **MCP Service**. The server has to be reachable over Streamable HTTP from the serverless compute plane, the workspace has to be in a region that supports Model Serving, and a service cannot be renamed after creation. Where the connection uses **per-user OAuth**, each user completes a one-time login from the MCP Service detail page before their first call; users with Consumer-level access cannot complete that flow at all.

### Granting it, and the grant not to make

Callers need `EXECUTE` on the service plus `USE CATALOG` and `USE SCHEMA` on its parents, exactly as in [[privileges-grant-revoke]]. The important negative: do **not** grant `USE CONNECTION` to end users. Invoking an MCP Service needs no privilege on the underlying connection, so a user holding `USE CONNECTION` can reach the server directly and skip the tool selection and the policies entirely.

### Choosing which tools are exposed

`include_tool_selectors` is an allowlist. A value ending in `*` is a prefix match, so `get_*` covers `get_me` and `get_issue`; anything else is an exact tool name. Omit the field or reset it to an empty list and every tool is exposed. There is an option to include tools the server adds later, a convenience with an obvious cost.

An unselected tool does not appear in `tools/list`, so the model never learns it exists. If something calls it anyway, the response is error code **-32003**, `Tool not allowed by MCP service configuration`. Changing the list later is a `PATCH` on the same field.

### Policies and rate limits

Service policies run in two phases: **ON CALL**, before the tool runs, and optionally **ON RESULT**, on what comes back. Each returns allow, deny, or require human approval, which is how "the agent may read a ticket but a person signs off before it closes one" becomes configuration rather than a line in a prompt. Policies are Beta, and the log-only habit described in [[ai-gateway-basics]] applies here too.

Rate limits are in **queries per minute only**, since token limits mean nothing for a tool call. The scopes are the same four as for a model service: the whole service, a default for every caller, named users or service principals, and groups. A service holds at most 20 rate limits, at most 5 of them group-specific, and a caller over the limit gets **HTTP 429**.

### Usage in the system tables

Three records, three questions. `system.ai_gateway.usage` filtered on `service_type = 'MCP_SERVICE'` answers how much, by whom, how slow and how often it failed, and Unity Gateway ships a dashboard over it. `system.access.audit` records control-plane changes and the invocations themselves, as the action `mcpCall`. Trace logging, enabled account-wide, records the requests, the responses and the policy decisions, which is the layer you want when a policy denied something and nobody can say why. See [[system-tables]] for how these behave generally.

## Example: a read-only GitHub server, then the bill

Expose four tools and nothing else, grant the support team, then check a week later:

```bash
databricks api patch \
  "/api/2.1/unity-catalog/mcp-services/main.default.github_readonly" \
  --json '{"config": {"include_tool_selectors": [
      "get_issue", "get_pull_request", "list_commits", "search_repositories"
  ]}}'
```

```sql
GRANT USE CATALOG ON CATALOG main TO `support-agents`;
GRANT USE SCHEMA ON SCHEMA main.default TO `support-agents`;
-- EXECUTE on the service has no SQL DDL: grant it in Catalog Explorer or by REST API.
```

```sql
SELECT requester,
       count(*)                                        AS calls,
       sum(CASE WHEN status_code >= 400 THEN 1 END)    AS failures,
       avg(latency_ms)                                 AS avg_latency_ms
FROM system.ai_gateway.usage
WHERE service_type = 'MCP_SERVICE'
  AND endpoint_name = 'main.default.github_readonly'
  AND event_time >= current_date() - INTERVAL 7 DAYS
GROUP BY ALL
ORDER BY calls DESC;
```

## Common mistakes

- **Granting `USE CONNECTION` to the people who use the agent.** It lets them reach the server directly and bypass the tool allowlist and every policy. Only the service needs the connection.
- **Registering a server and leaving `include_tool_selectors` empty.** The default is every tool, including whatever the provider has for deleting things. Choose the list deliberately: the model cannot call what it cannot see.
- **Expecting to invoke an agent through its agent service.** Runtime invocation is not available in Beta. The registration is an inventory entry; the agent still runs wherever it ran before.
- **Writing a `GRANT` script for either object.** Neither has SQL DDL, so permissions go through Catalog Explorer or the REST API, and a bundle cannot express them.
- **Setting only a service-wide rate limit.** One looping agent exhausts it for everybody. The per-caller default is what stops that.
