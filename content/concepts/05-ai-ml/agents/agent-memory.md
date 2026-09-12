---
id: agent-memory
title: Agent memory
area: agents
level: advanced
summary: Long-term memory for an agent as a Unity Catalog securable, with entries scoped and pathed, governed and audited like a table rather than kept in a side database.
prerequisites: [agent-framework, unity-catalog-overview]
related: [agent-framework, agent-tools-uc-functions, privileges-grant-revoke, mlflow-tracing, genie-ontology]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/agents/agent-memory/managed-memory
    checked: 2026-09-12
aliases: [agent memory, memory store, long-term memory, episodic memory, managed memory]
updated: 2026-09-12
status: published
maturity: beta
maturity_checked: 2026-09-12
---

## What it is

Managed agent memory gives an agent something to remember between conversations. Databricks runs the storage and the isolation; you get a **memory store**, which is a Unity Catalog securable holding entries.

An entry has a **scope**, which decides who it belongs to and who can see it, and a **path**, which organises entries hierarchically much like a file: `/memories/preferences.md`.

> [!note]
> This is in Beta as of September 2026. A workspace admin turns it on from the Previews page. Read it to know the shape of the thing; do not put a customer-facing agent's memory on it yet.

## Why it exists

An agent without memory re-meets its user every morning. It re-learns that they work in euros, that "the report" means the weekly one, that they never want the raw table. Every conversation starts from nothing, and the user does the remembering on the agent's behalf.

Teams solve this by bolting on a database. That works, and it puts the most sensitive data an agent holds, a record of what individual people asked and preferred, outside the governance everything else lives under. Nobody audits it, nobody knows the retention, and nobody can answer a deletion request against it.

Making the memory store a Unity Catalog object puts it back inside the system that already answers those questions.

## How it works

### Short-term and long-term are different problems

Short-term memory is the conversation you are in: the message history a framework keeps, whether that is the OpenAI conversation state or a LangGraph checkpointer. It is solved, and it is not what this is.

Long-term memory is what survives the conversation ending. That is what a memory store holds.

### Governance, which is the point

Memory stores inherit Unity Catalog governance, access control and lineage, with their own privileges:

| Privilege | Level | Allows |
| --- | --- | --- |
| `CREATE MEMORY STORE` | schema | make one |
| `READ MEMORY STORE` | store | read entries |
| `WRITE MEMORY STORE` | store | write entries |
| `MANAGE` | store | administer it |

Read that table as a policy rather than as an API. A support agent may need to write memory and never read another user's, which is a grant, not a code review.

### Reaching it

There is a REST API for stores and entries, and the OpenAI-compatible client in the `databricks-openai` SDK can bind a store to a conversation so the agent uses it without your code shuttling entries in and out.

## Example: the decision to make first

Before any of the API, decide what the agent is allowed to remember. That is a product decision with a legal edge, and the shape of the memory store should follow it.

A reasonable starting policy for an internal analytics agent: remember stated preferences, such as currency, default date range and the tables the person works with; do not remember the content of results; scope everything to the individual so one person's memory is never another's context. Everything in that sentence maps to a scope and a path, which is the point of having them.

The failure mode to design against is the agent that remembers something it should have forgotten and repeats it to somebody else. Scopes exist to make that a configuration error rather than an inevitability.

## Common mistakes

- **Storing memory outside governance because it is easier.** The one dataset that is definitely personal ends up as the one dataset nobody can audit.
- **Remembering everything.** Memory that accumulates without a policy becomes both a liability and noise, and noisy memory makes answers worse, not better.
- **Confusing memory with retrieval.** What the user said last week is memory. What the company knows is [[genie-ontology|the ontology]] and the indexes behind it. Putting company facts in per-user memory duplicates them badly.
- **Building on Beta.** It can change. Prototype, and keep the authoritative copy of anything you must not lose somewhere generally available.
