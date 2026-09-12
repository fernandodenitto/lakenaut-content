---
id: genie-code
title: Genie Code
area: sql-editor
level: beginner
summary: The assistant embedded across the workspace, governed by your own Unity Catalog permissions, with an agent mode that plans and runs work and asks before using a tool.
prerequisites: [notebooks-basics]
related: [sql-editor-basics, genie-agents, genie-ontology, unity-catalog-overview, notebooks-basics]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/genie-code/
    checked: 2026-09-12
aliases: [databricks assistant, genie code, agent mode, assistant, code assistant, /optimize]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

Genie Code is the assistant built into the workspace. It writes and runs code, builds pipelines and dashboards, explains and fixes errors, and reads Unity Catalog to know what your tables actually contain.

It is the thing you meet on your first day, which is why it is worth understanding properly rather than dismissing as autocomplete. It appears in notebooks, the SQL editor, the pipelines editor, AI/BI dashboards and MLflow, and it has a full-page home of its own where several chats can run in parallel.

This is the product that was called Databricks Assistant until March 2026. Anything written before then uses the old name.

## Why it exists

Most of the friction in a data workspace is not the hard part of the problem. It is remembering the exact name of a column, the syntax of a window function, which of four ways to read a JSON file is the current one, and what a stack trace means at the end of a long afternoon.

An assistant that can see the catalogue removes most of that. The interesting design decision is the governance one: it sees what you see, and nothing else.

## How it works

### It inherits your permissions

The sentence to remember is that Genie Code is governed by your Unity Catalog permissions, so it can only reach data and perform operations you are already allowed to. It is not a separate identity with its own grants.

That has a practical consequence people find surprising in both directions. It cannot leak a table you have no access to, and it also cannot help with one. If a colleague's example does not work for you, the difference is usually a grant.

### Inline help, and agent mode

The everyday use is inline: ask a question where you are, get code back, run it yourself. In the SQL editor that includes rewriting a query you already have.

**Agent mode** is the larger claim. It plans a multi-step task, writes and runs code, reads the error when something fails, fixes it, and continues. It asks for approval before using a tool, which is the part that makes it usable on anything that writes.

The honest framing is the same one that applies to any agent: it is very good at the mechanical middle of a task and it does not know what your business means by "active customer". That is what the [[genie-ontology|ontology]] and the knowledge curated on a [[genie-agents|Genie Agent]] are for.

### Skills and instructions

You can shape it with instructions and with skills, which are reusable pieces of context and capability rather than one-off prompts. This is how a team gets it to follow their conventions instead of the internet's average conventions.

### Where the boundary sits with the other Genie surfaces

| Surface | Audience | Question it answers |
| --- | --- | --- |
| Genie Code | whoever is building | "write this, fix this, explain this" |
| [[genie-agents]] | business users, on curated data | "what were sales last quarter" |
| Genie One | business users, one entry point | "show me the dashboards and let me ask" |

They share the [[genie-ontology|ontology]], so a definition curated once is visible to all three.

### What it costs

Genie Code moved to pay-as-you-go pricing on 8 July 2026, with a monthly free allowance. Genie One and Genie Agents usage is free until 31 January 2027. Worth knowing before a team turns agent mode loose on a backlog.

## Example: the two ways people actually use it

The first is repair. Paste a failing cell, ask what is wrong, get the fix and the reason. This is the use that converts sceptics, because the error message that means nothing to a newcomer is a solved problem for a model that has seen a million of them.

The second is the first draft. "Read the JSON files in this volume, flatten the nested address, and write a silver table partitioned by day" produces something structurally right and specifically wrong, which is a much better starting point than a blank cell. Then you fix the specifics, because you know the data and it does not.

## Common mistakes

- **Trusting the SQL because it ran.** A query that returns rows can still be answering a different question. Read the join conditions and the filters before you put the number in a slide.
- **Assuming it sees everything.** It sees what you can see. An empty or unhelpful answer about a table is frequently a permission problem wearing a disguise.
- **Using it where a Genie Agent belongs.** For a business user asking about curated data, a Genie Agent with a knowledge store gives better answers, because somebody curated it.
- **Letting agent mode run unattended on writes.** The approval step exists for a reason. Keep it.
- **Calling it the Assistant in a search.** The documentation moved to Genie Code in March 2026, and the old name now returns older material.
