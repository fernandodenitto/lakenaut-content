# CLAUDE.md — lakenaut-content

> The source of truth for anyone working in this repository, human or agent. Update it when a
> convention changes, not after.

Obsidian vault holding the theory behind **Lakenaut** ([lakenaut.dev](https://lakenaut.dev)). This
repository contains **only teaching content** and the script that validates it. The site, the agent
and the panel live in the separate `lakenaut` repository, which reads this folder through the
`CONTENT_DIR` environment variable.

## Rules

- **One concept, one file**, at `content/concepts/<NN-group>/<area>/<id>.md`. The filename is the
  `id` (ASCII kebab-case). Never duplicate an explanation: if it is needed elsewhere, wikilink it.
- **The folders mirror the site's sidebar**: a numbered group (`01-foundations`, `02-workspace`,
  `03-sql`, `04-data-engineering`, `05-ai-ml`) and inside it one folder per area, named exactly as
  the area's `id`. The number exists only so a file explorer lists the groups in the order the site
  does. The validator enforces the pair, so a concept cannot drift away from the area it claims.
- Images are referenced as `![alt](../../../attachments/name.svg)` — three levels, because a concept
  sits three levels below `content/`.
- `content/` opens in Obsidian **with no plugins**. No Dataview, no MDX, no plugin-only syntax.
- **Language: English.** Tone: a senior engineer explaining to a colleague. Product names as they are
  written today (Unity Catalog, Lakeflow Jobs, streaming table).
- Never copy text from the Databricks documentation. Read it, rewrite it, and cite the page in
  `sources`.
- No Databricks logo, icon or palette. Product names are used as nomenclature, nothing else.
- A roadmap needs both `exam_guide_url` and `exam_guide_version`. Every concept in a roadmap maps to
  a published objective.
- `status: published` is set by a human. The agent only ever proposes `draft` or `review`.

## Layout

```
content/
  .obsidian/       minimal vault config, committed
  concepts/        <NN-group>/<area>/<id>.md
  areas/           one hub page per sidebar entry
  paths/           stage-based learning paths
  roadmaps/        one per certification
  snippets/        reusable blocks, included with {{snippet: name}}
  attachments/     diagrams, as theme-neutral SVG
  naming/          one .yml per product rename
  previews/        one .yml per feature in beta or preview
  lifecycle/       one .yml per thing that is ending, with its date
scripts/validate.ts   validation, runs in CI
```

## Concept frontmatter

```yaml
---
id: jobs-task-dependencies          # = filename
title: Tasks and dependencies in a job
area: jobs-pipelines                # id of a file in areas/
subarea: jobs                       # optional
level: intermediate                 # beginner | intermediate | advanced
summary: One sentence, used in drawers and cards.
prerequisites: [jobs-overview]      # concept ids
related: [jobs-triggers]            # concept ids
exams:
  - cert: de-associate              # id of a file in roadmaps/
    domain: "Working with Lakeflow Jobs"   # the domain name exactly as the roadmap spells it
    objective: "…"                  # the objective, as the exam guide words it
sources:
  - url: https://docs.databricks.com/aws/en/…
    checked: 2026-09-09
aliases: [synonyms, old names]
updated: 2026-09-09
status: published                   # draft | review | published
maturity: ga                        # ga | public-preview | beta | private-preview | deprecated
maturity_checked: 2026-09-11        # required unless maturity is ga
---
```

### Maturity

`maturity` says how settled the *feature* is, not how finished the *text* is — that is `status`.
Anything other than `ga` puts a badge wherever the concept appears, a band at the top of its page,
and a row in `/preview/`. The rule: if the documentation page carries a Beta or Public Preview
banner, the concept says so in both the frontmatter and the prose, and never presents it as
something to build on. When a feature reaches GA, set `maturity: ga`, remove the warning from the
body, and delete the matching file in `content/previews/`.

### Renames

Databricks renames things often, and exam guides lag by months. Every rename that matters goes in
`content/naming/<old>-to-<new>.yml` with its date and source: the site shows it at `/naming/` and as
a quiet line on the concepts listed in `concepts:`. In the prose, use the current name and mention
the old one once — that is the one the exam question will use. Put the old name in `aliases` too.

## Concept body

The shape: `## What it is` → `## Why it exists` → `## How it works` → `## Example` →
`## Common mistakes`, closed by a callout — `> [!exam]` for exam-relevant concepts, `> [!tip]`
otherwise.

- Wikilinks: `[[jobs-triggers]]` or `[[jobs-triggers|text]]`. Only to ids that exist.
- Images: `![alt](../../../attachments/name.svg)`. Never `![[name.svg]]`.
- Code: fenced blocks tagged `sql` / `python` / `yaml` / `bash`. For equivalent SQL and Python, two
  consecutive blocks: the site renders them as tabs.
- Shared snippets: a line `{{snippet: name}}` including `content/snippets/name.md`.
- Callouts the site renders: `> [!exam]`, `> [!warning]`, `> [!tip]`, `> [!changed]`.
- Standard markdown tables are welcome for comparisons.

## Path frontmatter

```yaml
---
id: data-engineering
title: Data Engineering
tag: pipelines                 # the card's eyebrow
level: intermediate
hours: 60                      # estimate, 0 when unknown
order: 2                       # position in the sidebar and the index
icon: workflow                 # a name in ICONS, site/src/lib/icons.ts
summary: One or two sentences.
certs: [de-associate]          # linked roadmaps, optional
stages:
  - name: Ingest
    concepts: [ingestion-patterns, copy-into, auto-loader]
  - name: Transform
    concepts: [medallion-architecture, gold-layer-objects]
---
```

Stages are the columns of the map and concepts are its tasks. An id that does not exist yet stays in
the path as a *planned* node: the validator reports it as a warning, not an error. Edges come from
the `prerequisites` internal to the path, plus the chaining between stages.

## Area frontmatter

```yaml
---
id: jobs-pipelines
title: Jobs & Pipelines
label: Jobs & Pipelines            # sidebar label
sidebar_group: main                # foundations | main | sql | data-engineering | ai-ml
order: 3
aliases: [workflows]
summary: One or two sentences.
concept_order: [jobs-overview, …]  # order in the hub; anything unlisted goes at the end
---
```

## Roadmap frontmatter

See `content/roadmaps/de-associate.md`: `domains[]` with `name`, `weight`, `objectives[]`,
`concepts[]`.

## Validation

```bash
npm install
npm run validate
```

It checks: complete frontmatter, `id` matching the filename, the folder pair matching the area and
its sidebar group, every wikilink and cross-reference (`prerequisites`, `related`, `concept_order`,
`domains[].concepts`, `stages[].concepts`) resolving, `exams[].cert` and `domain` existing, images
and snippets existing, no orphan concept (one with no `related` and no backlink), and no `![[…]]`.

Required in every concept: `id`, `title`, `area`, `summary`, `updated`, `status`. Without `updated`
or `status` the site build fails.

## How this reaches the site

The site reads this folder at **build time**, not at runtime. Pushing to `main` here fires a
`content-updated` repository dispatch at the `lakenaut` repository, whose CI checks out both, builds
and deploys. So: a merged change here is live within a couple of minutes, and nothing in this
repository is ever read by the running site directly.

What lives here is the theory. What lives in the site's database is everything that changes faster
than a commit: news, external resources, exam hints, the review queue. The two meet through ids —
a news item names the concepts it affects, a resource names the paths it belongs to.

## Commits

Prefixes: `content:`, `docs:`, `scripts:`. The agent in the `lakenaut` repository opens pull requests
titled `agent(<job>): <concept>` and never touches `main`.
