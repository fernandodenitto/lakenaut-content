---
id: uc-domains-and-pages
title: Domains and Pages
area: genie
level: intermediate
summary: The human half of the Genie Ontology. Domains group assets by business purpose, Pages define what a business term actually means, and Genie prefers both over what it infers.
prerequisites: [genie-ontology, unity-catalog-overview]
related: [genie-ontology, metric-views, governed-tags, genie-agents, unity-catalog-overview]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/uc-semantics/domains
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/uc-semantics/pages
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/uc-semantics/
    checked: 2026-09-12
aliases: [domains, subdomains, pages, business glossary, unity catalog semantics, discover page, MANAGE DISCOVERY]
updated: 2026-09-12
status: published
maturity: public-preview
maturity_checked: 2026-09-12
---

## What it is

[[genie-ontology|The Genie Ontology]] has two halves. The inferred half is built for you from queries, dashboards and metric views. This page is about the other half, the one a person writes and Unity Catalog governs.

**Domains** are an organisation layer. They group data assets by business purpose so that somebody browsing can find things the way the company is arranged rather than the way the catalogues are. A domain can hold subdomains, one level deep and no further, and an asset can belong to several domains at once.

**Pages** are definitions. A Page is the authoritative statement of what a business concept means: a term, an entity, an acronym. It has an owner, synonyms, a description, a body that takes rich text and tables, the assets it relates to, and its sources.

> [!note]
> Domains are in Public Preview. Pages are in Beta, and an account admin turns them on from the Previews page in the account console. Read both as things to try, not to depend on.

## Why it exists

Every company has a glossary. It lives in a wiki nobody updates, in a spreadsheet somebody owns, or in the head of the analyst who has been there longest. The definition of "active customer" is agreed in a meeting and then re-derived, slightly differently, in nine dashboards.

The old failure was that the glossary and the data were separate artefacts, so the glossary drifted and nobody noticed. The point of putting this in Unity Catalog is that the definition sits next to the tables it describes, has an owner and permissions like anything else, and, crucially, is read by the machine that answers questions.

That last part is what makes it worth the effort. When somebody asks Genie One a question, it checks the ontology and **prefers the human-modelled context in your Pages over anything it inferred**, then cites the Page as its source. A definition written once changes the answers everybody gets.

## How it works

### Domains, and who may create them

A domain groups data products, assets and Pages, and it works with [[governed-tags|governed tags]] rather than replacing them: the tag says what an asset is, the domain says whose it is.

Two permissions matter:

| Permission | Who needs it | What it allows |
| --- | --- | --- |
| `MANAGE DISCOVERY` | curators | create, manage and customise domains. Account and workspace admins have it already |
| `BROWSE` or `VIEW` | consumers | see the assets inside a domain and on the Discover page |

`MANAGE DISCOVERY` can be granted account-wide, for one domain, or for one subdomain, which is how a central team keeps the top level tidy while letting each function run its own corner.

### Pages, and what makes a good one

A Page is written by whoever knows the answer, and the creator becomes the owner unless ownership is handed over. Curators hold the broader permissions across domains.

The fields are worth taking seriously, because they are what the ontology reads:

- **synonyms** are how the Page is found by somebody who uses a different word for the same thing, which is most people;
- **related assets** connect the definition to the tables and dashboards that implement it, which is what turns a glossary entry into something navigable;
- **sources** say where the definition came from, which is the difference between an authority and an opinion.

### Where this sits next to metric views

They are complementary and people confuse them.

A [[metric-views|metric view]] is executable: it defines a measure in SQL, and a query returns a number from it. A Page is prose: it defines what the measure means, for humans and for the model. A good pair does both, with the Page linked to the metric view as a related asset.

If you can only do one, do the metric view, because a wrong number is worse than an undefined term. Then write the Page so the next person knows why it is computed that way.

## Example: what "active customer" looks like when it is done properly

1. A metric view in the `finance` schema defines `active_customers` as distinct customers with an order in the trailing 90 days, deduplicated across platforms.
2. A Page titled **Active customer** sits in the Finance domain, owned by the head of revenue operations, with synonyms "active user" and "engaged customer", a body explaining why 90 days and not 30, related assets pointing at the metric view and the two dashboards that use it, and a source linking the decision to the meeting that made it.
3. Genie One, asked "how many active customers did we have last quarter", finds the Page, prefers it over anything it inferred from old queries, answers from the metric view, and cites the Page.

The work is in step two, and it takes an afternoon per concept that matters. Most organisations have fewer than thirty that matter.

## Common mistakes

- **Writing Pages for everything.** A glossary of four hundred terms is a glossary nobody reads and nobody maintains. Write the ones that get argued about.
- **Leaving out synonyms.** The Page is found by the word the asker used, not the word you chose as canonical.
- **Treating a domain as a permission boundary.** It organises discovery. Grants still decide who can read the data.
- **Expecting subdomain nesting.** One level. A structure that needs three is a structure that needs rethinking.
- **Building on Beta.** Pages can change. Keep the authoritative copy of anything contractual somewhere you control until it is generally available.
