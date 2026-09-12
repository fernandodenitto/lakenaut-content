---
id: agent-framework
title: Agents on Databricks
area: agents
level: intermediate
summary: The four ways to build an agent here, from a no-code assistant to your own Python, and which page covers each. Also the bridge between the old Agent Framework name and the current one.
prerequisites: [ai-playground, foundation-model-apis]
related: [agent-deployment-apps, agent-tools-uc-functions, mcp-on-databricks, agent-bricks, agent-evaluation]
exams:
  - cert: genai-engineer-associate
    domain: "Design Applications"
    objective: "Select chain components and an agent approach for a given business requirement."
sources:
  - url: https://docs.databricks.com/aws/en/agents/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/agents/custom-agents/author-agent
    checked: 2026-09-12
aliases: [agent framework, mosaic ai agent framework, custom agents, agent, tool calling, responses agent]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

An agent is a program that decides what to do. It takes a request, chooses which tools to call and in what order, reads the results, and produces an answer. The model does the choosing; everything else is ordinary software.

Databricks offers four ways to build one, and the right first question is which of the four you need rather than how to write the code.

| Approach | You give it | You write | Covered in |
| --- | --- | --- | --- |
| The playground | a model and a prompt | nothing | [[ai-playground]] |
| Knowledge Assistant | documents | nothing | [[agent-bricks]] |
| Supervisor Agent | other agents to route between | nothing | [[agent-bricks]] |
| Custom agent | code | all of it | [[agent-deployment-apps]] |

Most agents that ship start as one of the middle two and stay there. Writing custom code is the answer when the behaviour you need is not "answer from these documents" or "route to the right specialist".

> [!changed]
> This used to be called the **Mosaic AI Agent Framework**, and the exam guide still does. The documentation dropped the name: the section is now Custom Agents, and the Mosaic AI prefix is gone from the AI pages generally. The ideas did not change. See the [rename list](/naming/) for the rest of the family.

## Why it exists

A model on its own can only produce text. It cannot read your tables, call your service or look anything up, so the useful version of "an AI that answers questions about our data" is always a loop: ask the model what to do, do it, tell the model what happened, repeat until it has an answer.

Writing that loop is not hard. Making it governed is. The agent needs credentials to reach a table, and whoever is asking should not thereby gain access to data they cannot see. That is the part Databricks is actually building: agents, their tools, their memory and their traffic all as Unity Catalog objects with owners and grants.

## How it works

### The interface

A custom agent implements MLflow's **`ResponsesAgent`**. That is the contract: a request comes in, a response goes out, streaming optional. Frameworks sit on top of it, and the documentation demonstrates the OpenAI Agents SDK and LangGraph. An older interface, `ChatAgent`, is still supported, and Databricks recommends `ResponsesAgent` for anything new.

### Tools, which are the interesting part

An agent is only as useful as what it can call. Two mechanisms, and they are complementary:

- **Unity Catalog functions** as tools, when the query is known in advance and you want the governance that comes with a function. See [[agent-tools-uc-functions]].
- **MCP servers**, which is the broader and now more common route: Databricks-managed servers for Genie, AI Search, SQL and Unity Catalog functions, plus your own. See [[mcp-on-databricks]].

The governance argument is the same for both. A tool that runs as the caller cannot fetch what the caller could not fetch, which turns "can the agent leak this" from a question about prompts into a question about grants.

### Where it runs

The current deployment surface is **Databricks Apps**, with a built-in chat interface and the agent's own code in your control. Deploying an agent behind a Model Serving endpoint is now the legacy path, and the documentation says so.

If you inherit an agent logged as an MLflow model and served from an endpoint, it still works, and there is a documented migration. [[agent-deployment-apps]] covers both.

### Watching it and judging it

Every agent run should produce a trace: the inputs, the intermediate steps, the tool calls and the latency. That is [[mlflow-tracing]], and it is what makes a bad answer diagnosable rather than mysterious.

Judging quality is [[agent-evaluation]]: scorers and LLM judges run over an evaluation dataset in development, and over a sample of live traces in production.

## Example: the decision, not the code

A support team wants an assistant that answers questions from the product documentation.

Start with a **Knowledge Assistant**. Point it at the documents, use the feedback loop to correct what it gets wrong, and ship it. Most of the value arrives here and the work is curation rather than engineering.

Move to a **custom agent** when the requirement grows a verb: create the ticket, check entitlement before answering, escalate when the sentiment turns. Those are tool calls with consequences, which is where you need your own code, your own approval step and your own tests.

Do not start with the custom agent because it looks more serious. The version that ships is the one somebody maintains.

## Common mistakes

- **Writing code first.** Two of the four approaches need none, and they are where the documentation points you first.
- **Giving the agent a service account.** It then has access no individual user has, and the first data-leak question has no good answer. Run tools as the caller.
- **Skipping tracing until something breaks.** Traces are not observability overhead here, they are the raw material for evaluation.
- **Deploying to Model Serving because a tutorial said so.** Apps is the current path; the endpoint route is legacy and documented as such.
- **Calling it Agent Framework in a search and trusting the results.** The name is gone from the documentation, so results using it are older than the current design.

> [!exam]
> The Generative AI Engineer Associate guide still uses the words "Agent Framework" and asks you to select chain components and an agent approach for a requirement. Know the four approaches and what distinguishes them, that a custom agent implements `ResponsesAgent`, and that tools reach data either as Unity Catalog functions or through MCP servers. The governance answer the guide keeps circling is that the agent should act with the caller's permissions.
