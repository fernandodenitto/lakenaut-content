---
id: agent-bricks
title: "Agent Bricks: Knowledge Assistant and Supervisor Agent"
area: agents
level: intermediate
summary: "Two declarative agent builders: Knowledge Assistant answers questions over your documents with citations, and Supervisor Agent routes a request across up to 50 subagents and tools."
prerequisites: [rag-pipeline, unity-catalog-overview]
related: [agent-deployment-apps, agent-tools-uc-functions, genie-agents, ai-search-indexes, agent-evaluation]
exams:
  - cert: genai-engineer-associate
    domain: "Design Applications"
    objective: "Determine how and when to use Agent Bricks (Knowledge Assistant, Multiagent Supervisor, Information Extraction) to solve problems"
sources:
  - url: https://docs.databricks.com/aws/en/agents/agent-bricks/knowledge-assistant
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/agents/agent-bricks/multi-agent-supervisor
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/agents/agent-bricks/custom-llm
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/agents/agent-bricks/key-info-extraction
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/agents/agent-bricks/intelligent-document-processing
    checked: 2026-09-12
aliases: [agent bricks, knowledge assistant, supervisor agent, multiagent supervisor, multi-agent supervisor, instructed retriever, custom llm, information extraction]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

Two builders you configure instead of code, both reached from **Agents** in the workspace sidebar, both producing an agent endpoint you can query from the AI Playground, from an app, or over the API.

**Knowledge Assistant** is a question-and-answer chatbot over your own documents. It answers with citations and follows what the documentation calls an Instructed Retriever approach rather than a plain retrieval-augmented pipeline. **Supervisor Agent** coordinates other things: [[genie-agents|Genie Agents]], agent endpoints, Unity Catalog functions, tables, volumes, AI Search indexes, MCP servers and custom agents, delegating each request to whichever should answer it.

Their maturity differs. Knowledge Assistant carries no preview banner anywhere. Supervisor Agent carries none for the product either, but its **Python SDK is in Beta**, gated behind the account **Previews** page, so creating supervisors programmatically is less settled than building one in the UI. Two older components are now labelled legacy and both remain in Beta: **Custom LLM (legacy)** and **Information Extraction (legacy)**. Extraction work has moved to a newer Information Extraction and, more broadly, to Intelligent Document Processing, where the same capabilities are AI Functions callable from SQL.

## Why it exists

A document chatbot is a known shape, and [[rag-pipeline]] is the list of decisions it demands: how to parse, how to chunk, which embedding model, what to retrieve, whether to rerank, how to cite, how to evaluate. Most teams get chunking wrong first and spend a fortnight finding out. Knowledge Assistant removes those decisions and leaves the one lever that reliably improves answers: telling the agent what a good answer looks like for the questions it got wrong.

Supervisor Agent exists because of what happens next. Once a team has a Genie Agent for sales numbers, a Knowledge Assistant for the handbook and a function that looks up an order, the user is routing by hand, and a hand-written router is a prompt nobody maintains. The supervisor makes routing a configuration with access control attached, so a user only gets answers from subagents they are already allowed to use.

## How it works

### Knowledge Assistant: knowledge sources

Up to ten sources per assistant, of three kinds.

| Source type | What it accepts | Notes |
| --- | --- | --- |
| Files in a volume | txt, pdf, md, ppt or pptx, doc or docx | a volume or a directory inside one |
| Files in a table | a streaming table, or a table with change data feed enabled | content column of `BINARY` or `STRING`, defaulting to `content`, plus a `metadata` or `_metadata` struct |
| AI Search index | an existing index, with a text column and a doc URI column for citations | see [[ai-search-indexes]] |

Two constraints decide whether your data fits. The `metadata` or `_metadata` `STRUCT` on a table source has to carry `file_path`, `file_name`, `file_size` and `file_modification_time`; the managed SharePoint and Google Drive connectors produce that shape, while Jira or Confluence tables usually need a transform. An AI Search index is accepted only if it was built with `databricks-gte-large-en`, `databricks-bge-large-en` or `databricks-qwen3-embedding-0-6b`, and the embedding model cannot be changed once the index exists.

Each source takes a **description**, and it is not decoration: the assistant uses it to decide which source to consult. The first build and sync can take a few hours. After that, syncs are incremental and, for file sources, manual: adding files to a volume does nothing until somebody with `CAN MANAGE` clicks **Sync**. Index-based sources update on their own.

Ingestion silently drops more than you expect: files over 100 MB, PDF, DOC, DOCX, PPT and PPTX files over 500 pages (a slide counts as a page, because ingestion runs `ai_parse_document` and that is its per-document limit, while txt and md have no page limit), and files whose names begin with `_` or `.`. For a table source, only the selected content column is read.

### Knowledge Assistant: the feedback loop

This is what distinguishes it from a hand-built pipeline. In the **Examples** tab you add the questions your users ask, or the ones the agent answered badly, and attach **Guidelines** in plain English to each. Guidelines take effect as soon as they are saved, so the loop is: ask, read **View thoughts**, **View trace** and **View sources** to see why the answer was wrong, write a guideline, ask again.

The useful guidelines come from people who know the subject rather than from engineers, so the flow is built to be shared: grant a domain expert `CAN_MANAGE` and send them the configuration page. Labelled data moves in and out as a Unity Catalog table with the columns `eval_id`, `request`, `guidelines` (an array of strings), `metadata` and `tags`, which is also how you keep a question set in version control and feed it to [[agent-evaluation]].

### Supervisor Agent: subagents and permissions

Up to 50 tools and subagents, each with a description the supervisor uses for delegation, so a vague description produces a supervisor that routes badly. A hand-written agent joins the list like anything else, as an app (see [[agent-deployment-apps]]). The supported types, with the permission the *end user* needs:

| Subagent or tool | End-user permission |
| --- | --- |
| Genie Agent | access to the agent and its underlying Unity Catalog objects |
| Knowledge Assistant, agent endpoint, Supervisor Agent | `CAN QUERY` on the endpoint |
| Model serving endpoint | `CAN QUERY` |
| Unity Catalog function | `EXECUTE` |
| Unity Catalog table, AI Search index | `SELECT`, plus `USE CATALOG` and `USE SCHEMA` |
| Unity Catalog volume | `READ VOLUME`, plus `USE CATALOG` and `USE SCHEMA` |
| Published dashboard | `CAN VIEW` |
| MCP Service, external MCP server | `EXECUTE` on the service, or `USE CONNECTION` on the connection |
| Custom MCP server or custom agent hosted as an app | `CAN_USE` on the app |

Access control is enforced at conversation time, not at configuration time. If the user can reach none of the subagents the supervisor ends the conversation; if they can reach some, it steers away from the ones they cannot. That is what is happening when a supervisor "stops knowing things" for one person.

### Supervisor Agent: the two built-in tools

Every supervisor gets a **code execution** tool without being asked, and decides for itself when to use it. It runs Python by default, plus SQL and shell, in a sandboxed serverless session that blocks all outbound network traffic regardless of the workspace network policy, reads only the Unity Catalog tables and volumes you added as tools, applies the end user's permissions to them, and cannot see workspace files.

**Web search** is opt-in and narrower than it looks: it always runs on `databricks-gpt-5` whatever model powers the supervisor, so the workspace needs that model in its `system.ai` allowlist, the end user approves each search before the query leaves the workspace, and it is unavailable with the Enhanced Security and Compliance add-on.

On both builders the permissions are **Can Manage** (edit the configuration and improve quality) and **Can Query** (use the endpoint, without seeing the agent on the Agents page), and by default only the author and workspace admins have either.

## Example: creating a Knowledge Assistant from the SDK

The builder is a UI, but the SDK is how you put one in a bundle or replicate it between workspaces:

```python
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.knowledgeassistants import FilesSpec, KnowledgeAssistant, KnowledgeSource

w = WorkspaceClient()

assistant = w.knowledge_assistants.create_knowledge_assistant(
    knowledge_assistant=KnowledgeAssistant(
        display_name="hr-policy-assistant",
        description="Answers employee questions about leave, expenses and benefits.",
        instructions="Answer only from the handbook. If it is silent on a point, say so and name the team to ask.",
    )
)

w.knowledge_assistants.create_knowledge_source(
    parent=assistant.name,  # "knowledge-assistants/<id>"
    knowledge_source=KnowledgeSource(
        display_name="handbook",
        description="The current employee handbook, one PDF per policy area.",
        source_type="files",
        files=FilesSpec(path="/Volumes/main/hr/handbook"),
    ),
)

# Files added to the volume are not visible to the agent until a sync runs.
w.knowledge_assistants.sync_knowledge_sources(name=assistant.name)
```

Exporting the labelled question set gives you an ordinary table, so a regression check is a query:

```sql
SELECT eval_id, request, guidelines
FROM main.hr.assistant_labels
WHERE size(guidelines) = 0;   -- questions nobody has written a guideline for yet
```

## Common mistakes

- **Pointing an assistant at a volume of long PDFs.** Anything over 500 pages is skipped at ingestion and nothing says so at answer time: the agent has no idea the document exists. Split them first.
- **Reusing an AI Search index built with the wrong embedding model.** Only three are accepted and the model is fixed at index creation, so this means rebuilding the index, not changing a setting.
- **Adding files and not syncing.** File-based sources need a manual **Sync**; only index-based sources refresh on their own.
- **Writing thin source and subagent descriptions.** Both builders route on them. "Company docs" and "the sales agent" produce an agent that consults the wrong thing at the wrong moment.
- **Giving experts the link but not the grant.** Feedback needs `CAN_MANAGE`, and for a supervisor the expert also needs access to each subagent, or they review a conversation the supervisor deliberately cut short.
- **Expecting the code-execution tool to fetch something.** It has no network egress and no data access beyond the tables and volumes you attached.
- **Starting from Custom LLM or the old Information Extraction.** Both are legacy and still Beta. New extraction work belongs in the current Information Extraction, or in the SQL AI Functions under Intelligent Document Processing.

> [!exam]
> The Generative AI Engineer Associate guide asks you to "determine how and when to use Agent Bricks (Knowledge Assistant, Multiagent Supervisor, Information Extraction) to solve problems", so it tests selection rather than configuration. Knowledge Assistant for question answering with citations over a document corpus; Supervisor Agent, which the guide still calls Multiagent Supervisor, for routing across existing agents and tools; Information Extraction for turning unlabelled documents into a structured table. Know that each produces an agent endpoint, that quality improves through questions plus natural-language guidelines rather than prompt editing, and that a supervisor's end users need permissions on every subagent individually.
