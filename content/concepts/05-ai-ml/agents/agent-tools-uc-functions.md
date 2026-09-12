---
id: agent-tools-uc-functions
title: Agent tools as Unity Catalog functions
area: agents
level: advanced
summary: Registering a Python or SQL function in Unity Catalog turns it into a governed agent tool, where the docstring becomes the schema the model reads and EXECUTE decides who may call it.
prerequisites: [agent-framework, unity-catalog-overview]
related: [mcp-on-databricks, privileges-grant-revoke, agent-evaluation, vector-search-basics, genie-agents]
exams:
  - cert: genai-engineer-associate
    domain: "Design Applications"
    objective: "Define and order tools that gather knowledge or take actions for multi-stage reasoning."
sources:
  - url: https://docs.databricks.com/aws/en/agents/custom-agents/create-custom-tool
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/agents/mcp-tools/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/agents/mcp-tools/managed-mcp
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/agents/mcp-tools/use-mcp-in-agents
    checked: 2026-09-11
aliases: [unity catalog functions, uc functions, agent tools, tool calling, ucfunctiontoolkit, databricksfunctionclient, managed mcp, mcp server, python_exec]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

A **tool** is a function the model may decide to call in the middle of answering. On Databricks the durable place to keep one is Unity Catalog: you register a Python or SQL function, it gets a three-level name, an owner, a comment and grants, and from then on it is a tool any agent can be given rather than code that belongs to one agent.

Two pieces do the work. `DatabricksFunctionClient` registers and executes the function, and either a managed **MCP server** or a toolkit class hands it to the agent runtime. [[agent-framework]] covers how the agent itself is authored, traced and deployed; this page is about the tools it is allowed to reach.

## Why it exists

A tool defined inline in an agent's source has three problems that only show up later. It is invisible: nobody outside the repository knows the agent can issue refunds. It is duplicated: the second and third agents that need "look up order status" write their own, and two of the three have a subtly different definition of "status". And it is ungoverned: the function reads a table, so it is a data access path, but it is protected by whoever can merge a pull request rather than by the grants on that table.

Registering the function in the catalog fixes all three at once, because the catalog is already the thing that answers "who can read this" and "what exists". The question "what can this agent do to production" becomes a query rather than a code review.

## How it works

### Registering a Python function

`DatabricksFunctionClient.create_python_function()` takes a Python callable and creates a Unity Catalog function from it. The function has to be written so that the catalog can describe it:

- **type hints on every parameter and the return value**, using types Spark supports;
- **no `*args` or `**kwargs`**, because every argument must be declared;
- a **Google-style docstring** with a summary and an `Args:` section;
- **imports inside the function body**, not at module level, since only the body is stored.

It needs Databricks Runtime 15.0 or above and Python 3.10 or above.

### Registering a SQL function

For anything that is really a query, SQL is the better source. `CREATE FUNCTION` with a `COMMENT` on the function and on each parameter produces exactly the same kind of object, and the function runs where the data is instead of shipping rows to Python.

### The docstring is the tool schema

This is the part people underestimate. As the documentation puts it, the toolkit "reads, parses, and extracts important information from your docstring": the summary becomes the tool description, and each `Args:` entry becomes a parameter description. In SQL, the `COMMENT` clauses play the same role.

That text is the only thing the model sees when it decides whether to call the tool and what to pass it. A docstring that says "gets order info" produces an agent that calls the tool at the wrong moment and fills the arguments badly. Vague wording here is a behaviour bug, not a documentation debt, and it is worth iterating on the description the way you would iterate on a prompt.

### Serverless or local execution

`DatabricksFunctionClient(execution_mode="serverless")` is the default and the production path: the client fetches the function definition from Unity Catalog and runs it on serverless generic compute, which is why serverless has to be enabled in the workspace.

`execution_mode="local"` runs Python functions in a local subprocess instead, which is much faster to iterate on while writing the function. It is development-only, Python-only, and deliberately bounded by three environment variables: `EXECUTOR_MAX_CPU_TIME_LIMIT` (10 seconds by default), `EXECUTOR_MAX_MEMORY_LIMIT` (100 MB) and `EXECUTOR_TIMEOUT` (20 seconds). A tool that works locally and times out on serverless is usually a tool doing too much.

### Handing tools to an agent

Databricks recommends **MCP servers**, and ships managed ones so there is no server to build or host. They are in Public Preview as of September 2026.

| Managed MCP server | URL |
| --- | --- |
| Unity Catalog functions | `https://<workspace-hostname>/api/2.0/mcp/functions/{catalog}/{schema}` or with a `/{function_name}` on the end |
| AI Search | `https://<workspace-hostname>/api/2.0/mcp/ai-search/{catalog}/{schema}/{index_name}` |
| Genie One | `https://<workspace-hostname>/api/2.0/mcp/genie` |
| A single Genie Agent | `https://<workspace-hostname>/api/2.0/mcp/genie/{genie_space_id}` |
| Databricks SQL | `https://<workspace-hostname>/api/2.0/mcp/sql` |

A schema is the unit of exposure: point an agent at `/api/2.0/mcp/functions/main/support_tools` and it gets every function in that schema it has rights to, with no per-tool wiring. The path can be narrowed to a single function when you want a tighter surface. `system.ai` is worth knowing about, because it already contains ready-made functions including a code interpreter, `system.ai.python_exec`.

For frameworks that expect tool objects rather than an MCP connection, `UCFunctionToolkit(function_names=[...])` from `databricks_langchain` wraps the same functions and exposes them through its `tools` property.

### Why the governance is the point

A tool is not a helper function, it is an action with a blast radius. Putting it in Unity Catalog means the controls are the ones already in place for data (see [[privileges-grant-revoke]]): a caller needs `EXECUTE` on the function plus `USE CATALOG` and `USE SCHEMA`, and managed MCP servers use on-behalf-of-user authentication with per-service OAuth scopes, so an agent reaches only what the person using it could reach anyway. The same grants that protect a table protect the tool built on top of it.

The practical consequence is the one that matters on an incident call: revoking `EXECUTE` disables the tool for every agent at once, immediately, with nothing to redeploy.

## Example: one SQL tool, one Python tool, one agent

```sql
CREATE OR REPLACE FUNCTION main.support_tools.order_status(
  order_ref STRING COMMENT 'The order reference printed on the customer receipt, for example ORD-44812.'
)
RETURNS STRING
COMMENT 'Returns the current fulfilment status and courier tracking number for one order. Use when a customer asks where their order is.'
RETURN SELECT concat('Status: ', status, ', tracking: ', coalesce(tracking_number, 'not yet dispatched'))
       FROM main.silver.orders
       WHERE order_reference = order_ref
       LIMIT 1;
```

```python
from unitycatalog.ai.core.databricks import DatabricksFunctionClient

client = DatabricksFunctionClient(execution_mode="serverless")

def refund_window_days(purchased_on: str, category: str) -> int:
    """
    Returns how many days are left in the refund window for a purchase.

    Args:
        purchased_on (str): Purchase date in ISO format, for example 2026-08-30.
        category (str): Product category, one of 'electronics', 'clothing', 'grocery'.

    Returns:
        int: Days remaining, or 0 if the window has closed.
    """
    from datetime import date
    windows = {"electronics": 30, "clothing": 60, "grocery": 0}
    elapsed = (date.today() - date.fromisoformat(purchased_on)).days
    return max(0, windows.get(category, 14) - elapsed)

client.create_python_function(
    func=refund_window_days,
    catalog="main",
    schema="support_tools",
    replace=True,
)

client.execute_function(
    function_name="main.support_tools.refund_window_days",
    parameters={"purchased_on": "2026-08-30", "category": "electronics"},
)
```

Giving both to an agent through the managed MCP server:

```python
from databricks.sdk import WorkspaceClient
from databricks_mcp import DatabricksMCPClient

workspace_client = WorkspaceClient()
host = workspace_client.config.host

mcp_client = DatabricksMCPClient(
    server_url=f"{host}/api/2.0/mcp/functions/main/support_tools",
    workspace_client=workspace_client,
)

print([t.name for t in mcp_client.list_tools()])
# ['main__support_tools__order_status', 'main__support_tools__refund_window_days']
```

Note the tool names: the dots of the catalog name become double underscores, which is what you call with `mcp_client.call_tool(...)`.

## Common mistakes

- **A thin docstring.** The description and the `Args:` entries are the tool's entire interface to the model. "Looks up an order" gets called at the wrong time; the version above says when to use it and what the argument looks like.
- **`*args`, `**kwargs`, or a missing return type hint.** Registration fails, and the error is easier to read once you know the catalog needs a full signature to describe.
- **Importing at module level.** Only the function body is stored in Unity Catalog, so `from datetime import date` has to live inside the function.
- **Leaving `execution_mode="local"` in deployed code.** It is a development convenience with a 20-second timeout and a 100 MB memory ceiling, not a serving path.
- **Granting `EXECUTE` on a schema of tools as one gesture.** A schema is the unit an MCP server exposes, so a read-only lookup and an action that writes should not share one.
- **Rebuilding Genie or AI Search access as a custom function** when a managed MCP server already exposes it with the right scope and on-behalf-of-user authentication.

> [!exam]
> The Generative AI Engineer Associate guide asks you to "define and order tools that gather knowledge or take actions for multi-stage reasoning", and a separate objective covers integrating managed, external and custom MCP servers. Know that a tool is a Unity Catalog function, that the Python docstring or the SQL `COMMENT` is what the model reads when choosing it, and that `EXECUTE` plus `USE CATALOG` and `USE SCHEMA` is the whole permission story. The distinction that catches people out: managed MCP servers are the ready-made path to Unity Catalog functions, Genie, AI Search and Databricks SQL, while a custom MCP server is for tools that live outside Databricks entirely.
