---
id: genie-one
title: Genie One
area: genie
level: beginner
summary: "Genie One is the simplified Databricks surface for business users: dashboards, Genie Agents and Databricks Apps in one place, reachable with the Consumer access entitlement alone."
prerequisites: [genie-agents]
related: [dashboards-overview, genie-ontology, genie-conversation-api, dashboard-schedules-and-subscriptions]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/genie-one/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/genie-one/chat
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/ai-bi/consumers/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/ai-bi/release-notes/2026
    checked: 2026-09-12
aliases: [databricks one, genie, consumer access, business user ui, /one, account-level genie, genie chat]
updated: 2026-09-12
status: published
maturity: ga
---

> [!changed]
> **Databricks One became Genie One.** It was renamed to *Genie* on 27 April 2026 and to *Genie One* on 9 June 2026, with no change in capability. The product itself has been generally available since 20 January 2026. Older material, courses and exam guides say "Databricks One".

## What it is

**Genie One** is the Databricks user interface for people who consume data rather than build it. It is one entry point that holds three kinds of asset: AI/BI dashboards, [[genie-agents|Genie Agents]], and Databricks Apps. There is no compute picker, no notebook, no query editor and no model registry, because none of those are concepts a business user should need.

Reach it by appending `/one` to a workspace URL, or through the app switcher in the top right of the workspace. A user whose only entitlement is Consumer access lands there at sign-in and never sees the full workspace at all.

## Why it exists

Two problems, and the second is the interesting one.

The first is surface area. A finance manager who wants one dashboard should not have to navigate a workspace built for engineers, and historically the way to keep them out of it was to not give them a workspace account at all, which pushed the numbers into spreadsheets outside Unity Catalog.

The second is routing. Once an organisation has forty Genie Agents, "which one answers my question" becomes the bottleneck. Genie One's chat takes the question first and picks the agent, instead of asking the user to pick and then ask. That is why it is more than a skin over the workspace.

## How it works

### What is on the home page

The search bar does two things: **Search** finds assets shared with you by name, and **Ask**, when enabled, turns the same bar into the entry to chat. Below it, **For you** shows recently opened assets, favourites, recent shares, and what is trending among similar users. Searching opens a **listing page** filterable by asset type, owner, status (certified, or your own favourites), domain and last modified. **Documents** drafts a shareable document from a conversation. **Domains**, which groups assets by business context instead of catalog hierarchy, is in **Public Preview**. Admins can customise the home page for everyone: colours, a logo, a markdown welcome message and pinned content.

### The entitlement it needs

The entitlement is **Consumer access**, a workspace entitlement an admin assigns to a user or group. It adds business users to the workspace under the ordinary permissions model while blocking them from creating workspace objects.

The catch is that entitlements are **additive**, so a user only gets the simplified experience if Consumer access is their *sole* entitlement in the workspace. Grant Workspace access or Databricks SQL access on top and the full workspace UI comes back. Users with Consumer access also cannot see SQL warehouses or Query History, even when they have been granted permissions on them, although they can still be granted warehouse access for use from Power BI or Tableau.

One transitional detail matters right now. Until a workspace migrates to the new entitlement behaviour, Consumer access users inherit whatever the `users` system group grants, which can quietly hand them workspace access. Databricks enforces the new behaviour for all workspaces on **14 September 2026**, after which entitlements are chosen per principal.

Two capabilities need more than Consumer access: chat requires `CAN USE` on at least one SQL warehouse, and creating a Genie Agent from inside Genie One requires Workspace access or Databricks SQL access.

### Workspace level against account level

| | Workspace-level | Account-level |
| --- | --- | --- |
| Scope | one workspace | every workspace in the account |
| Who can use it | workspace members with at least one entitlement; Consumer access is enough | all account users, including those with no workspace membership |
| What they see | assets in that workspace shared with them | only assets explicitly shared with them, across workspaces |
| URL | `<workspace-url>/one` | `accounts.cloud.databricks.com/one` |

Account-level Genie One is a discovery surface: opening an asset hands you back to its originating workspace, and seeing that workspace's data still requires Consumer access there. It excludes workspaces with the compliance security profile enabled, and Databricks-generated metadata such as asset identifiers and usage signals may be processed in the US, with customer metadata following the account's Geo settings. An account admin can disable it from the account console without affecting the workspace-level surface.

### How it relates to Genie Agents

Chat is a full-screen natural-language interface, and it resolves a question in a fixed order: it looks for a relevant Genie Agent first, uses that agent if it finds one, and only then falls back to searching dashboards, queries and metric views. Both Genie One and Genie Code read the same **Genie Ontology** (see [[genie-ontology]]), so context curated once applies to both, and citation icons in a response show which sources were used.

The relationship runs the other way too: a conversation that has accumulated useful context can be saved as a Genie Agent, then edited or deleted conversationally. Opening an agent depends on your rights, view-only as a chat inside Genie One and authoring rights as **Edit draft** in the workspace UI. Two chat settings are worth knowing: **level of effort** (`Auto` by default, `Low` for cheaper simple tasks, workspace chat only) and compute, which defaults to **Auto**. Admins can also add instructions that apply to every chat conversation, as a markdown file in a fixed location under 20,000 characters, affecting chat only and neither agents nor Genie Code.

### How it relates to dashboards

Dashboards are first-class assets here: a viewer with view rights opens a published dashboard inside Genie One, and **Ask Genie** on that dashboard starts a conversation scoped to it. Genie One's **scheduled tasks** overlap with dashboard subscriptions and are not the same thing: a scheduled task is a recurring prompt whose answer is emailed and posted back into a chat thread, where a subscription delivers a snapshot of a fixed dashboard (see [[dashboard-schedules-and-subscriptions]]).

### The newer additions, and how finished they are

Several of the capabilities people associate with Genie One are not generally available. As of September 2026:

| Capability | Status |
| --- | --- |
| Memory: facts you ask Genie One to keep and reuse later | Beta, needs the Genie One Memory preview |
| Memory confirmation prompts, where it proposes a memory and asks first | Beta, added September 2026 |
| Web search for questions needing current public information | Beta, needs the preview turned on |
| File upload into a conversation | Beta |
| Personalised starter questions on the home page | Beta |
| Domains | Public Preview |
| The macOS desktop app | Beta |
| User skills, personal repeatable tasks invoked with `/` | Public Preview |
| Chat, documents, and account-level Genie One | generally available |

Two of those carry conditions worth reading before you promise anything. **Web search** additionally needs partner-powered AI features enabled and a workspace in the Americas or Europe (or cross-geography processing turned on), and for compliance security profile workspaces it is supported only for HIPAA. **Memory** is private per user and is not the same thing as recalling past conversations, which is always on, needs no setup, and only ever draws on your own threads.

## Example: workspace-wide chat instructions

Chat reads one markdown file at a fixed path, with no configuration. Keeping it in Git and deploying it is the difference between a convention and a wish.

```markdown
# Data conventions for this workspace

- Fiscal year starts on 1 February. FY26 means 2026-02-01 to 2027-01-31.
- "Revenue" always means net revenue. Never quote gross revenue without labelling it.
- Exclude rows where region = 'TEST' unless the question is explicitly about test data.
- Amounts are in EUR unless a currency column says otherwise. Round currency to two decimals.
- When a question does not name a time range, ask which period to use before answering.
```

Deploying it to the path chat expects:

```bash
databricks workspace import /Workspace/.genie_workspace_instructions.md \
  --file ./genie/workspace_instructions.md \
  --format RAW --overwrite
```

The same conventions, if they should also govern a specific domain's answers, belong in that agent's instructions rather than here (see [[genie-agent-tuning]]), because this file does not reach Genie Agents.

## Common mistakes

- **Granting Consumer access on top of an existing entitlement and expecting the simplified UI.** Entitlements add up. Consumer access has to be the only one for a user to land in Genie One.
- **Assuming Consumer access users can see a warehouse you granted them.** They can use it from a BI tool but cannot view the warehouse or Query History in the product.
- **Confusing account-level with workspace-level.** Account-level is cross-workspace discovery; the data still lives in a workspace and still needs Consumer access there.
- **Building a workflow on memory or web search.** Both are Beta, both need a preview enabling, and web search has geography and compliance conditions on top.
- **Putting domain rules in the workspace instructions file.** It applies to chat only. A Genie Agent never reads it.
- **Treating a scheduled task as a dashboard subscription.** One re-asks a question, the other re-renders a dashboard. They fail differently and are configured in different places.

> [!tip]
> Genie One is not on any current exam guide: the October 2025 Data Analyst Associate guide predates the name and covers AI/BI dashboards and Genie spaces directly. The fact worth carrying anyway is the entitlement model, because it is the part that decides whether a business user ever sees this surface at all.
