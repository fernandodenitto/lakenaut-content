---
id: genie-ontology
title: The Genie Ontology
area: genie
level: intermediate
summary: The context layer shared by Genie One and Genie Code. Half of it is Unity Catalog semantics that a human governs, half is ranked snippets Genie infers from existing assets.
prerequisites: [genie-agents]
related: [genie-knowledge-store, metric-views, unity-catalog-overview, dashboards-overview, genie-benchmarks-monitoring]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/genie/genie-ontology
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/uc-semantics/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/uc-semantics/pages
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/ai-bi/release-notes/2026
    checked: 2026-09-11
aliases: [ontology, genie ontology, ontology snippets, modeled context, inferred context, unity catalog semantics, authority score]
updated: 2026-09-11
status: published
maturity: public-preview
maturity_checked: 2026-09-11
---

## What it is

The **Genie Ontology** is one context layer, shared across the Genie surfaces. Genie One and Genie Code, the two neighbours of a [[genie-agents|Genie Agent]], search the same ontology, so a definition curated once reaches both instead of being re-entered per tool.

> [!note]
> This is in Public Preview as of September 2026. It can change without notice and it is not on any exam guide. Read it to know it exists, not to build on it. Databricks states that curating ontology snippets carries no charge at the moment, and that it may change that with notice.

It has two halves that work very differently:

- **Modelled context** is Unity Catalog semantics: [[metric-views|metric views]], domains and subdomains, Pages, and certification or deprecation flags. A person writes it, Unity Catalog governs it, and it is authoritative by construction.
- **Inferred context** is a map of **snippets** that Genie extracts and maintains automatically from assets you already have: metric views, dashboards, SQL queries and Genie Agents. Nobody writes them by hand.

The documented examples of an inferred snippet are worth reading closely, because they show the shape of the thing. A metric definition: "An 'active user' is a distinct user, deduplicated across all platforms." An authoritative source: "Revenue questions should be answered using the curated Finance Genie Agent." A business rule: "A 'qualified lead' only counts once a demo is booked."

## Why it exists

Tuning a single Genie Agent well is real work, and until the ontology existed that work stayed inside that agent. A second agent over overlapping tables started from nothing, and Genie Code, the coding assistant, could not see any of it. Meanwhile the organisation's actual definitions were already written down, just scattered: in the `SUM(...)` inside a certified dashboard, in a query somebody runs every Monday, in a metric view's comments.

The ontology attacks both problems at once. It lifts curated context out of the per-agent scope, and it harvests what is implicit in existing assets instead of asking people to restate it. There is a performance argument too: ranking a short list of relevant snippets is cheaper than crawling and querying broadly, so answers come back faster as well as more often correct.

## How it works

### Snippets, authority and permissions

Every inferred snippet carries an **authority score** derived from three things: where it was generated from, how often it is used, and how fresh it is. A definition pulled from a certified metric view that a hundred people query weekly outranks one lifted from a query somebody wrote once.

Snippets are gated by Unity Catalog permissions. Genie only uses snippets extracted from assets the asking user is allowed to see, which means two colleagues can get legitimately different answers from the same prompt. When a question arrives, Genie ranks the relevant snippets, resolves conflicts between them, and answers from the permitted set. The citation icons on a response show which knowledge sources it used.

### It is not the agent knowledge store

This is the distinction that matters, because the two layers sound alike and sit next to each other in the product.

| | Genie Ontology | Agent knowledge store |
| --- | --- | --- |
| Scope | the whole workspace, shared by Genie One and Genie Code | one Genie Agent |
| Who writes it | modelled half: a human, in Unity Catalog. Inferred half: Genie | the agent's author |
| Effect on Unity Catalog | the modelled half *is* Unity Catalog metadata; the inferred half changes nothing | none |
| What it holds | ranked snippets plus metric views, domains, Pages and certification | descriptions, synonyms, hidden columns, joins, SQL expressions, prompt matching |
| How it is governed | Unity Catalog permissions on the source asset, per snippet | permissions on the agent |

They are complements, not alternatives. [[genie-knowledge-store]] is still where you fix a specific agent's blind spots, and the ontology is where a definition goes when it should hold everywhere. If you find yourself typing the same synonym into a third agent's knowledge store, that is the signal to model it once as a metric view instead.

### Where modelled context comes from

Four Unity Catalog features feed the modelled half:

- **Metric views**, which bring measures, fields and their synonyms already defined and governed.
- **Domains and subdomains**, which group assets by business purpose so people and Genie can browse by meaning rather than by catalog name.
- **Pages**, a governed definition of a business term, entity or acronym, attached to a domain. When Genie One answers a question about a concept that has a Page, it prefers the Page's definition over anything inferred, and cites it. Pages are in Beta and account admins control access from the account console Previews page.
- **Certification and deprecation**, the signals that say which assets the organisation vouches for.

### How it reached its current state

| Date | What changed |
| --- | --- |
| June 2026 | Genie Ontology announced in Public Preview: Genie One starts building and maintaining the map automatically |
| 2 July 2026 | ontology snippets in Public Preview, available on request through the account team |
| 6 August 2026 | the ontology is enabled by default, still in Public Preview |
| 13 August 2026 | ontology snippets available to all customers, no request needed |

Enabled by default is the part to notice. If your workspace has dashboards and saved queries, Genie is already extracting snippets from them.

## Example: feeding the modelled half

Nothing creates ontology snippets directly. What you control is the modelled context, and a metric view with real metadata is the densest thing you can give it: the definition, the vocabulary and the permission boundary in one object.

```sql
CREATE OR REPLACE VIEW sales.gold.activity_metrics WITH METRICS LANGUAGE YAML AS
$$
version: 1.1
comment: "Governed activity KPIs. Active user is deduplicated across platforms."
source: sales.gold.sessions_daily

fields:
  - name: activity_date
    expr: session_date
    display_name: 'Activity Date'

measures:
  - name: active_users
    expr: COUNT(DISTINCT user_id)
    comment: 'Distinct users, deduplicated across web, iOS and Android'
    synonyms: ['actives', 'DAU', 'active user count']
$$;

-- The grant is also the ontology boundary: snippets extracted from this view
-- reach the people who can read it, and nobody else.
GRANT SELECT ON sales.gold.activity_metrics TO `sales-analysts`;
```

Certifying that view in Catalog Explorer and putting the term "active user" on a Page in the same domain is what turns one governed object into context Genie will prefer over anything it infers.

## Common mistakes

- **Treating it as a replacement for tuning an agent.** A Genie Agent still needs its own knowledge store, trusted assets and benchmarks. The ontology raises the floor; it does not do the agent's job.
- **Forgetting that answers are permission-shaped.** Two users asking the same question can get different answers, because each sees only the snippets from assets they can read. Reproduce a complaint as the person who reported it.
- **Leaving two contradictory definitions in circulation.** The ontology will find both and rank them. Deciding which one wins is a governance act: certify the right asset, or write the Page.
- **Expecting inferred context to fix Unity Catalog.** A snippet extracted from a dashboard does not add a column comment or a key. The catalog stays exactly as poor as you left it.
- **Building a process on it while it is in preview.** It is enabled by default, which makes it easy to forget it is still Public Preview and can change without notice.

> [!tip]
> The useful reading of the ontology for an author is as an incentive: work you do in Unity Catalog now pays out in two places at once. A metric view with comments and synonyms improves SQL, dashboards and every Genie surface, while the same definition typed into a single agent's knowledge store improves exactly one thing.
