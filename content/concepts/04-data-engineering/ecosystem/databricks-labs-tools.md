---
id: databricks-labs-tools
title: Databricks Labs, the tools around the platform
area: ecosystem
level: intermediate
summary: Labs projects are open-source, unsupported, and often the fastest answer to migration, data quality, test data and scaffolding. What each one does and how much to lean on it.
prerequisites: [cli-and-sdk]
related: [dqx-framework, data-quality-overview, bundles-overview, unity-catalog-overview, secrets-management]
exams: []
sources:
  - url: https://www.databricks.com/learn/labs
    checked: 2026-09-11
  - url: https://github.com/databrickslabs
    checked: 2026-09-11
  - url: https://github.com/databrickslabs/dbx
    checked: 2026-09-11
aliases: [databricks labs, labs projects, ucx, lakebridge, dbldatagen, tempo, dbx]
updated: 2026-09-11
status: published
---

## What it is

Databricks Labs is the organisation where Databricks engineers publish open-source projects that are useful but are not platform features. Every repository carries the same notice: provided as-is, no service level agreement, file a GitHub issue and someone will look when they can.

That sentence is the whole trade-off. A Labs project can save you a quarter of work, and it can also change an API in a minor release with nobody to escalate to.

## Why it exists

Some problems are too specific to become product features and too common to leave everyone solving alone: moving a legacy workspace onto Unity Catalog, translating ten thousand lines of stored procedures, generating a believable test dataset, checking quality in a job that is not a pipeline. Labs is where those live.

## How it works

### Quality

- **[[dqx-framework|DQX]]** validates PySpark DataFrames and tables, batch or streaming, and splits clean rows from quarantined ones. This is the one with the most momentum: it ships a no-code studio, an MCP server and a quality dashboard. `pip install databricks-labs-dqx`.

### Migration

- **UCX** automates the move to Unity Catalog: it assesses a workspace, groups the findings, migrates tables out of `hive_metastore`, and rewrites the code in jobs, notebooks and dashboards that still points at the old names. If you inherited a workspace older than Unity Catalog, start here rather than with a spreadsheet. Check the commit history before you commit to it: there has been no release since October 2025.
- **Lakebridge** (the project formerly called Remorph) automates migration **onto** Databricks from other warehouses: profiling the source, converting SQL dialects, and reconciling the results row by row so you can prove the migration was faithful.

### Pipelines

- **sdp-meta**, formerly `dlt-meta`, drives bronze and silver pipelines from metadata instead of hand-written notebooks: one specification per dataset, one generic pipeline that reads it. It is the rare Labs project with a page in the official documentation, and it was renamed when Delta Live Tables became Lakeflow pipelines.

### Test data and testing

- **dbldatagen** generates synthetic data at Spark scale from a declarative spec: column ranges, distributions, weighted values, foreign-key-like relationships. Useful for load tests and for demo data that is not somebody's real customer list.
- **pytester** provides pytest fixtures for Databricks: a workspace client, throwaway objects that clean themselves up, and helpers for writing integration tests that actually touch a workspace.

### Libraries and scaffolding

- **Blueprint** is the shared foundation the other Labs projects are built on: configuration, logging, installation into a workspace, command-line entry points. It is the baseline to copy when you write a Python tool of your own for Databricks.
- **lsql** is a thin SQL execution wrapper over the Databricks SDK, for tools that need to run a query without pulling in a full Spark session.

### Analysis and administration

- **Tempo** adds a time-series API on top of Spark: as-of joins, lagged values, resampling, rolling statistics. The operations that are painful to write with window functions alone.
- **DiscoverX** runs an operation across many tables at once, which is how you answer platform-wide questions such as "which tables contain a column that looks like an email address". It has been quiet since 2025 and part of its classification API is marked deprecated, so treat it as a useful script rather than a dependency.
- **Lakemeter** estimates what a workload will cost before you run it: DBU sizing, cloud cost, and the comparison between configurations. It deploys as a Databricks App rather than a library.

### Historical: dbx

**dbx** was the deployment tool for Databricks jobs before bundles existed. Its README now opens by saying the project is **no longer actively maintained** and recommends Databricks Asset Bundles, now Declarative Automation Bundles, for CI/CD. If you find `dbx deploy` in a repository, you are looking at pre-bundle code: see [[bundles-overview]] for what replaces it.

## How much to lean on a Labs project

Ask four questions before it reaches production:

1. **Is it moving?** Check the commit history and the latest release date, not the star count. And check the right place: for `dbldatagen` and Tempo the real artefact ships on PyPI, while the GitHub release tags lag behind.
2. **Is it pinned?** Pin an exact version in your bundle or cluster library. "Latest" is how a Tuesday morning breaks.
3. **Is it reversible?** UCX rewriting your jobs is a large, mostly one-way action. Run the assessment, read it, and migrate in slices.
4. **Who owns it here?** An unsupported dependency needs an owner on your side, or it becomes nobody's problem until it is everybody's.

For anything that must be supported, prefer the platform feature even when it does less: [[pipelines-expectations]] over a framework, Declarative Automation Bundles over a deployment script, Unity Catalog lineage over a graph you build yourself.

## Common mistakes

- **Reading "Databricks Labs" as "Databricks".** It is the same company, not the same commitment. There is no support ticket, and most Labs projects are never mentioned in the official documentation at all.
- **Assuming a Labs project outlives its problem.** Overwatch, the cost and usage observability project, is archived and deprecated: system tables do that job now. Check for a deprecation notice before adopting anything.
- **Installing from `main`.** A Labs project is a dependency like any other: pin it, and read the changelog before bumping.
- **Using UCX as a one-click migration.** The assessment is the valuable part. The rewrite still needs someone who knows which jobs matter.
- **Starting a tool from scratch.** Before writing a workspace utility, check Labs: Blueprint, lsql and pytester exist precisely so you do not write that layer again.

> [!note]
> None of this is on an exam guide. It is the part of the job the exams cannot test: knowing what already exists before you build it.
