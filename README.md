<div align="center">

<img src=".github/assets/mark.png" alt="" width="88">

# Lakenaut Content

**Databricks, one concept per file.**<br>
An Obsidian vault that is also a website.

[![Site](https://img.shields.io/badge/read%20it-lakenaut.dev-e2590b?style=flat-square)](https://lakenaut.dev)
[![Validate](https://img.shields.io/github/actions/workflow/status/fernandodenitto/lakenaut-content/validate.yml?branch=main&style=flat-square&label=validate)](https://github.com/fernandodenitto/lakenaut-content/actions/workflows/validate.yml)
![Concepts](https://img.shields.io/badge/concepts-163-e2590b?style=flat-square)
![Paths](https://img.shields.io/badge/paths-8-e2590b?style=flat-square)
![Roadmaps](https://img.shields.io/badge/roadmaps-5-e2590b?style=flat-square)
![Obsidian](https://img.shields.io/badge/obsidian-ready-7c3aed?style=flat-square&logo=obsidian&logoColor=white)

[![Content licence](https://img.shields.io/badge/content-CC%20BY--NC--SA%204.0-6E6862?style=flat-square)](LICENSE)
[![Code licence](https://img.shields.io/badge/code-MIT-6E6862?style=flat-square)](LICENSE-CODE)
![Not affiliated](https://img.shields.io/badge/not%20affiliated%20with-Databricks-9C9590?style=flat-square)
[![Discuss](https://img.shields.io/badge/discuss-r%2Flakenaut-ff4500?style=flat-square&logo=reddit&logoColor=white)](https://www.reddit.com/r/lakenaut/)

**[Read it on the site](https://lakenaut.dev) · [Open it in Obsidian](#read-it-in-obsidian) · [Browse the index](INDEX.md) · [Feed an LLM](llms.txt)**

</div>

---

This is theory, not a link farm: every concept is written out in full, in Databricks-specific terms, not generic SQL/Python tutorials with a Databricks label. The rule that keeps it coherent is simple — **one concept, one markdown file**. If an idea needs to show up somewhere else, it gets a wikilink, never a copy-paste.

## Read it on the website

[lakenaut.dev](https://lakenaut.dev) renders this same content with a sidebar organized by Databricks product area, certification roadmaps with a drawer per concept, and a d3-force graph of every wikilink.

## Read it in Obsidian

This is the part that matters most: the `content/` folder is a real [Obsidian](https://obsidian.md) vault, and it opens with zero setup.

1. Clone the repo, or download it as a ZIP:
   ```bash
   git clone https://github.com/fernandodenitto/lakenaut-content.git
   ```
   [Download ZIP](https://github.com/fernandodenitto/lakenaut-content/archive/refs/heads/main.zip)
2. Open Obsidian.
3. Choose **Open folder as vault** and point it at the `content/` folder (not the repo root).

That's it. `content/.obsidian/` is committed with a minimal config, so you get, with no plugins to install:

- **Graph view** with colour groups per area (Jobs & Pipelines, Catalog, Compute, Data Engineering, Workspace, Foundations, Roadmaps each get their own colour).
- **Backlinks** and the **outgoing links** pane on every note.
- **Search** across the whole vault.
- Every `[[wikilink]]` resolved, since it links to a real file in the vault.

Callouts render natively — `> [!exam]` and `> [!tip]` show up as styled admonitions, exactly like on the site. Images are standard markdown (`![alt](../../../attachments/name.svg)`), so they display normally. The one thing that does **not** render in Obsidian is `{{snippet: name}}` — it shows as plain text. That's by design: it's a build-time include the site resolves against `content/snippets/`, and Obsidian has no reason to know about it.

## What is inside

```
content/
├── concepts/              163 concepts, one per file, in the order the site's sidebar shows them
│   ├── 01-foundations/      foundations-sql · foundations-python
│   ├── 02-workspace/        workspace · catalog · compute · jobs-pipelines · marketplace
│   ├── 03-sql/              sql-editor · sql-warehouses · dashboards · genie · alerts · query-history
│   ├── 04-data-engineering/ data-ingestion · delta-lake · streaming · data-quality · runs · ecosystem
│   └── 05-ai-ml/            models · experiments · features · serving · agents · ai-gateway · playground · vector-search
├── areas/                 27 hub pages, one per sidebar entry, each listing its concepts in order
├── paths/                 8 stage-based learning paths, independent of any exam
├── roadmaps/              5 certification roadmaps, each pinned to an official exam guide version
├── naming/                what Databricks renamed, when, and what it was called before
├── previews/              features in preview or beta that have no concept yet
├── lifecycle/             what is ending, with the date
├── snippets/              reusable code blocks, included with {{snippet: name}}
└── attachments/           diagrams, as theme-neutral SVG
```

The number in front of a group folder is there for one reason: a file explorer sorts alphabetically,
and without it the vault would list AI before the foundations that AI depends on. Inside a group,
one folder per product area, named exactly as the area's `id`. The validator enforces the pairing,
so a concept cannot drift away from the area it claims.

Folders carry no meaning beyond that. A concept's `id` is its filename, and its `area` is in the
frontmatter — moving a file between folders changes nothing except where you find it.

## How a concept is written

Every concept file lives at `content/concepts/<NN-group>/<area>/<id>.md`. The filename is the `id`.

```yaml
---
id: jobs-overview
title: Lakeflow Jobs, what a job is
area: jobs-pipelines
subarea: jobs
level: beginner
summary: A job is the unit of orchestration in Databricks, a graph of tasks that runs on a compute of your choice, with triggers, parameters, and notifications.
prerequisites: []
related: [jobs-task-dependencies, jobs-triggers, jobs-parameters, pipelines-overview, compute-options]
exams:
  - cert: de-associate
    domain: "Working with Lakeflow Jobs"
    objective: "Configure common tasks (notebook, SQL query, dashboard, and pipeline tasks) and their dependencies using Lakeflow Jobs and its DAG-based task graph"
sources:
  - url: https://docs.databricks.com/aws/en/jobs/
    checked: 2026-09-09
aliases: [workflows, lakeflow jobs, job]
updated: 2026-09-09
status: published
---
```

The body follows a fixed structure: `## What it is` → `## Why it exists` → `## How it works` → `## Example` → `## Common mistakes`, closed by a callout — `> [!exam]` for exam-relevant concepts, `> [!tip]` otherwise.

## Contributing

1. Fork the repo.
2. Add or fix a concept under `content/concepts/<NN-group>/<area>/<id>.md`, following the frontmatter shape above.
3. Run the validator:
   ```bash
   npm install
   npm run validate
   ```
4. Open a pull request.

The validator enforces: complete frontmatter (`id`, `title`, `area`, `summary`, `updated`, `status`), the file's `id` matching its filename in kebab-case, the folder pair matching the concept's `area` and its sidebar group, every wikilink and cross-reference (`prerequisites`, `related`, `exams[].cert`/`domain`, roadmap and path `concepts[]`) resolving to a real file, referenced images and snippets existing, no Obsidian-only `![[embed]]` syntax, no duplicate ids, and no orphan concepts (a concept needs at least one `related` link or one backlink). It runs in CI on every push and pull request.

`status: published` is set by a human, in a review pass, never by the agent that watches Databricks docs for changes — the agent only ever proposes `draft` or `review`.

## Licence

Two licences, because there are two kinds of thing in here.

- **The writing** — every concept, path, roadmap and note — is under
  [Creative Commons BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). Share it,
  translate it, build on it, with attribution, under the same terms, and not commercially.
- **The code** — everything in `snippets/`, every fenced block inside a concept, and the scripts at
  the repo root — is [MIT](LICENSE-CODE). Copy it into your own pipeline without a thought.

The non-commercial clause is there because the author sells courses built on this material; it is not
a claim over the underlying facts, which belong to nobody. If you want to use this commercially, ask.

See [LICENSE](LICENSE) for the content terms, [LICENSE-CODE](LICENSE-CODE) for the code, and
[NOTICE.md](NOTICE.md) for the trademark and accuracy disclaimer.

## What this is not

This is an independent project. It is **not affiliated with, endorsed by, or sponsored by Databricks
Inc.** Databricks, Unity Catalog, Lakeflow, Delta Lake, MLflow and Apache Spark are the trademarks of
their owners, used here only to say what the material is about.

Nothing here is an official exam guide or a promise about what an exam contains. Every concept cites
the documentation it was written from; none of it reproduces that documentation. The platform changes
weekly — check the official docs before doing anything irreversible in production.
