---
id: marketplace-delta-sharing
title: Marketplace and Clean Rooms
area: marketplace
level: intermediate
summary: Marketplace is the public catalogue of data, models and notebooks built on sharing. Clean Rooms are the opposite trade, a joint computation where neither side sees the other's rows.
prerequisites: [unity-catalog-overview, opensharing-overview]
related: [opensharing-overview, unity-catalog-overview, privileges-grant-revoke, gold-layer-objects]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/marketplace/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/clean-rooms/
    checked: 2026-09-11
aliases: [marketplace, listing, data products, clean rooms, collaboration, discover]
updated: 2026-09-11
status: published
maturity: ga
---

## What it is

Two products sit on top of the sharing machinery described in [[opensharing-overview]], and they answer opposite questions.

**Marketplace** answers "how do I find data I do not have?". It is a public catalogue of listings: datasets, machine learning models, notebooks and solution accelerators, published by providers and browsable by anyone with a Databricks account. Accepting a listing wires up a share and a recipient behind the scenes, exactly as if the provider had configured them by hand.

**Clean Rooms** answer "how do we compute on each other's data without either of us handing it over?". Two or more parties agree on a computation, run it in an isolated environment, and get only the result. Nobody reads the other side's rows, ever.

Sharing gives a recipient a standing read-only catalogue. A clean room gives everybody an answer and nothing else. Choosing between them is a question about trust, not about technology.

## Why it exists

Buying data used to mean a contract, an SFTP endpoint and a pipeline to ingest yesterday's extract. Marketplace removes the pipeline: a listing you accept appears as a catalogue in your own metastore and stays current, because it is a share and not a copy.

Clean rooms exist for the case sharing cannot cover. Two retailers want to know how many customers they have in common. A bank and an advertiser want to measure whether a campaign moved real spending. Neither side may see the other's customer list, and a regulator would object if they did. The old answer was a trusted third party and a legal agreement. A clean room replaces the third party with an environment that neither participant controls.

## How it works

### A Marketplace listing

A provider publishes a **listing**: a description, sample data or documentation, terms of use, and the assets themselves. Listings can be free with instant access, free on request, or paid through the provider's own arrangement. A consumer who accepts an instant listing gets a catalogue in their metastore within seconds; a request-based listing goes to the provider first, who approves or declines.

What a listing can hold goes beyond tables. A provider can publish a model, a notebook, or a set of notebooks packaged as a solution accelerator, which is how most of the "here is how you use this data" content on Marketplace arrives.

Becoming a provider means a profile, terms, and listings that Databricks reviews before they go public. Private exchanges exist for the case where you want the listing experience without the public audience.

### What the consumer actually gets

The same thing a recipient of a share gets: a read-only catalogue, live against the provider's data, revocable by the provider at any moment. Nothing is cached locally, so a revoked listing simply stops resolving. This catches people out when a proof of concept quietly depends on a listing somebody else can withdraw.

### A clean room

A clean room is created by one party and joined by invited **collaborators**. Inside it, a participant runs a notebook or a packaged workload against the combined data, on serverless compute that belongs to neither side. The output is written back to an agreed location; the inputs are never readable across the boundary.

Two shapes are worth knowing:

- **Notebook workloads**, where a collaborator writes the analysis and every participant can review what will run before it runs.
- **Packaged clean rooms**, where the computation is fixed in advance and a participant runs it without writing code, which is the shape most measurement partnerships take.

The approval step is the point. A clean room is not only an isolation boundary, it is a place where the question everyone agreed to is visible, and the questions nobody agreed to cannot be asked.

## Example: deciding between the three

| You want to | Use |
| --- | --- |
| Give a named partner live access to a table | A share and a recipient, see [[opensharing-overview]] |
| Publish data or a model for anyone to find | A Marketplace listing |
| Measure an overlap without revealing either list | A clean room |
| Query a table that stays in another system | [[lakehouse-federation]] |

## Common mistakes

- **Treating a listing as a download.** It is a share. If the provider withdraws it or drops the underlying table, your queries stop working and there is no local copy to fall back on.
- **Publishing sensitive data to a public listing.** Consumers get standing access, not a one-time extract. Review what is in the tables, not only what is in the description.
- **Reaching for a clean room when a share would do.** Clean rooms cost more to set up and constrain what you can ask. If the other party is allowed to see the rows, share them.
- **Reaching for a share when a clean room is required.** If the agreement says the other side must not see individual records, a share with a row filter is still the wrong instrument: the filter is your control, not theirs.
- **Forgetting the compute bill.** Queries against a share or a clean room run on somebody's compute, and it is usually the consumer's.

> [!tip]
> In an exam question, the word that decides the answer is usually "without revealing". Sharing reveals rows to a named recipient. A clean room reveals only the result of an agreed computation.
