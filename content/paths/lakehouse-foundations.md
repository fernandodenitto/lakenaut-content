---
id: lakehouse-foundations
title: "Lakehouse Foundations"
tag: "start here"
level: beginner
hours: 20
order: 1
icon: layers
summary: "How the Databricks platform is put together: control plane and compute, Delta Lake as the storage format, Unity Catalog as the governance layer, and the medallion pattern everything else builds on."
certs: [de-associate]
stages:
  - name: "The platform"
    concepts: [platform-architecture, compute-options]
  - name: "Storage"
    concepts: [delta-lake-overview, managed-vs-external-tables]
  - name: "Governance"
    concepts: [unity-catalog-overview]
  - name: "Working in the lakehouse"
    concepts: [medallion-architecture, git-folders, notebooks-basics, workspace-files-volumes]
---

Start here if Databricks is new to you. Seven concepts that make every other path readable: what runs where, what a table really is, who is allowed to read it, and how raw data becomes something a dashboard can trust.

After this path, pick [[data-engineering|Data Engineering]] to build pipelines or [[governance-security|Governance & Security]] to go deeper on Unity Catalog.
