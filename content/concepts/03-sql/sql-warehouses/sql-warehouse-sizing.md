---
id: sql-warehouse-sizing
title: Sizing a SQL warehouse
area: sql-warehouses
level: intermediate
summary: How warehouse type, t-shirt size, and cluster scaling combine to set query latency, concurrency, and cost.
prerequisites: [platform-architecture, compute-options]
related: [query-profile, jobs-overview, compute-options]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/compute/sql-warehouse/
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/compute/sql-warehouse/warehouse-types
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/compute/sql-warehouse/warehouse-behavior
    checked: 2026-09-10
aliases: [warehouse sizing, t-shirt size, warehouse type, dbsql warehouse, serverless warehouse]
updated: 2026-09-10
status: published
---

## What it is

A **SQL warehouse** is compute dedicated to running SQL: the SQL editor, dashboards, alerts, Genie Agents, and any BI tool connecting over JDBC/ODBC all point at one. Setting one up means two separate choices — a **type** (serverless, pro, or classic) and a **size** (a t-shirt size, from 2X-Small up), plus how many clusters it is allowed to add when concurrency spikes.

## Why it exists

A warehouse is a cluster shaped for short, concurrent, unpredictable SQL statements rather than long batch jobs. Giving it its own sizing model — instead of reusing job-cluster settings — lets Databricks manage things that matter specifically for interactive SQL: sub-10-second startup, automatic multi-cluster load balancing under bursty concurrency, and a queue instead of a crash when demand outpaces capacity.

## How it works

### Type

| | Serverless | Pro | Classic |
| --- | --- | --- | --- |
| Compute runs in | Databricks' account | your cloud account | your cloud account |
| Startup | seconds | a few minutes | a few minutes |
| Predictive I/O | yes | yes | no |
| Autoscaling | intelligent, workload-aware | manual min/max | manual min/max |
| Typical use | default choice, ETL/BI/exploration | serverless unavailable, custom networking, federation | basic interactive queries |

Serverless is the default recommendation where available: fast cold start and workload-aware scaling. Pro and classic run compute inside your own cloud account, which is why they take minutes rather than seconds to start.

### Size

Size (2X-Small, X-Small, Small, Medium, Large, and up) sets how many workers and how much memory a single cluster of the warehouse gets — larger sizes handle bigger scans and heavier joins per query, independent of how many concurrent queries the warehouse serves.

### Scaling: min and max clusters

Concurrency, not query size, is what multiple clusters solve: one cluster of a warehouse can only run so many queries in parallel before the rest wait. Pro and classic warehouses scale between a configured minimum and maximum number of clusters, roughly one extra cluster added for every ten or so concurrent queries once wait times start to grow; serverless manages this automatically. Every warehouse also has a shared queue: once every cluster is saturated, new queries wait rather than fail.

### Auto-stop

An idle warehouse still bills, so every warehouse has an **auto-stop** interval: no query for that long and it shuts down, spinning back up on the next request (instantly for serverless, in minutes for pro/classic).

### Cost model

Warehouses bill in DBUs per second while running, scaled by type and size; serverless carries a different DBU rate than pro/classic because Databricks — not you — is running the underlying VMs. More clusters running in parallel means more DBUs consumed, even at the same size.

### Warehouse vs. job cluster

A warehouse beats a job cluster whenever many people or tools issue short, ad-hoc SQL statements that need to share compute and start fast — dashboards, alerts, BI tools, analysts in the SQL editor. A job cluster wins for a single long-running pipeline that owns its compute end to end; see [[jobs-overview]].

## Example

```python
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import EndpointInfoWarehouseType

w = WorkspaceClient()

w.warehouses.create(
    name="analytics-serverless",
    cluster_size="Small",
    warehouse_type=EndpointInfoWarehouseType.PRO,
    enable_serverless_compute=True,
    min_num_clusters=1,
    max_num_clusters=4,
    auto_stop_mins=10,
)
```

The same warehouse declared as a bundle resource, so its sizing lives in version control next to the jobs that depend on it:

```yaml
resources:
  sql_warehouses:
    analytics:
      name: analytics-serverless
      cluster_size: Small
      warehouse_type: PRO
      enable_serverless_compute: true
      min_num_clusters: 1
      max_num_clusters: 4
      auto_stop_mins: 10
```

## Common mistakes

- Bumping the size the moment a query feels slow, without checking the [[query-profile]] first — the fix is often a filter or a join, not more compute.
- Capping `max_num_clusters` at 1 on a warehouse serving many BI users, then wondering why dashboards queue at 9am.
- Choosing pro or classic out of habit when serverless is available in the region, and paying for it in cold-start latency.
- Forgetting auto-stop on a warehouse used sporadically, leaving it running (and billing) overnight.
- Pointing a nightly ETL job at a shared warehouse instead of giving it its own job cluster.

> [!tip]
> Concurrency problems and query-speed problems have different fixes: raise `max_num_clusters` for the first, raise the t-shirt size (or fix the query) for the second. Read the queue depth and per-query time separately before touching either knob.
