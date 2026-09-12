---
id: sql-warehouse-types-and-channels
title: SQL warehouse types and channels
area: sql-warehouses
level: intermediate
summary: The three generally available warehouse types and the Beta fourth one, which acceleration features each has, how fast each starts, and what the Preview channel is for.
prerequisites: [compute-options, sql-warehouse-sizing]
related:
  [
    sql-warehouse-sizing,
    serverless-compute,
    runtime-and-photon,
    lakehouse-federation,
    sql-query-caching,
  ]
exams:
  - cert: data-analyst-associate
    domain: "Executing queries using Databricks SQL and Databricks SQL Warehouses"
    objective: "Explain the role a SQL warehouse plays in query execution."
sources:
  - url: https://docs.databricks.com/aws/en/compute/sql-warehouse/warehouse-types
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/compute/sql-warehouse/create
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/compute/sql-warehouse/warehouse-behavior
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/compute/sql-warehouse/real-time
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/release-notes/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/dev-tools/bundles/resources
    checked: 2026-09-12
aliases:
  [
    warehouse type,
    serverless warehouse,
    pro warehouse,
    classic warehouse,
    lakehouse real-time,
    lakehouse rt,
    preview channel,
    current channel,
    dbsql version,
  ]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

A SQL warehouse has two settings that decide what engine you get, and neither of them is the t-shirt size. The **type** decides where the compute runs and which acceleration features the engine has. The **channel** decides which Databricks SQL compute version that engine is, Current or Preview.

Three types are generally available: **serverless**, **pro** and **classic**. A fourth, **Lakehouse Real-Time**, is in Beta and is a different animal. Sizing, scaling and auto-stop are a separate set of decisions, covered in [[sql-warehouse-sizing]].

## Why it exists

Photon, Predictive IO and Intelligent Workload Management are not switches you tick on a warehouse. They are properties of the compute plane it runs on, and the type is how you choose that plane. Serverless compute lives in the Databricks account, which is what makes a two-second start and AI-driven admission control possible at all; pro and classic run virtual machines in your own cloud account, which is what makes them slow to start and also the only option when your network rules say the compute has to be yours.

Channels solve a different problem. Databricks ships new Databricks SQL compute versions regularly, and everything pointed at a warehouse rides along: dashboards, alerts, BI extracts, jobs that run SQL. You cannot usefully test an engine upgrade after it lands, so the Preview channel gives you a warehouse running the next version now.

## How it works

### The feature matrix

| Type       | Photon | Predictive IO | Intelligent Workload Management | Compute runs in        | Typical startup |
| ---------- | ------ | ------------- | ------------------------------- | ---------------------- | --------------- |
| Serverless | yes    | yes           | yes                             | the Databricks account | 2 to 6 seconds  |
| Pro        | yes    | yes           | no                              | your own cloud account | about 4 minutes |
| Classic    | yes    | no            | no                              | your own cloud account | about 4 minutes |

Two of the three features draw the lines:

- **Photon** is the vectorised query engine, and every type has it (see [[runtime-and-photon]]).
- **Predictive IO** is a set of features that speed up selective scans. Pro and serverless have it; classic does not. This is the difference between pro and classic.
- **Intelligent Workload Management** predicts a query's resource needs, admits it if there is capacity, queues it if not, and scales clusters based on how queue wait times are moving. It is serverless only. This is the difference between serverless and pro.

### Startup time, and everything that follows from it

Two to six seconds against roughly four minutes is not a detail, because auto-stop is tuned around it. Pro and classic default to stopping after **45 minutes** idle in the UI (minimum 10; through the API and bundles the default is 120). Serverless defaults to **10 minutes** (minimum 5 in the UI, and as low as 1 minute if you create the warehouse through the SQL warehouses API). A four-minute restart forces you to keep a pro warehouse warm through the working day, so it bills through the working day. A serverless warehouse can genuinely go to sleep between two dashboard loads.

### What you get by default

The default depends on how you create the warehouse, which catches people out:

- **UI**: serverless, in a region and workspace that support it, otherwise pro.
- **SQL warehouses API with default parameters**: classic. To get serverless you set `enable_serverless_compute` to `true` **and** `warehouse_type` to `PRO`.

The default cluster size is X-Large in either case. A workspace still on a legacy external Hive metastore cannot run serverless warehouses at all, and falls back to pro in the UI and classic through the API.

### When pro or classic is still the right answer

Pro, for two reasons only: serverless is not available in your region, or you need the compute inside your own network, typically to reach on-premises or in-network databases through query federation (see [[lakehouse-federation]]). Classic is the entry-level option, with no Predictive IO, and there is rarely a deliberate reason to pick it.

### Lakehouse Real-Time (Beta)

> [!warning]
> **Lakehouse Real-Time** (short name **Lakehouse//RT**) is in **Beta** as of September 2026. Your account team has to enable it, a workspace admin has to switch on the **Lakehouse RT** preview, and the documentation states that its performance characteristics and supported feature set will change before general availability. It is on no exam guide. Read this to know it exists, not to build on it.

Lakehouse//RT is a serverless type for sub-second read queries at high concurrency: serving analytical data to applications, operational analytics, dashboards with hundreds to thousands of concurrent viewers. Once the preview is on, **Real-Time** appears as a type in the creation flow.

It is read-only: `SELECT` against Unity Catalog managed tables in Delta Lake or Iceberg format, plus materialized views, streaming tables and metric views. No writes, no DDL, no `GRANT`, no `OPTIMIZE`, `ANALYZE` or `VACUUM`, no temporary tables, no external or Hive metastore tables, no federation, no system tables, no Genie, no jobs tasks. ANSI mode is always on and cannot be turned off, so queries that relied on non-ANSI casting may raise errors instead of returning `NULL`.

Sizing works differently too. A **Query size** (Small, Medium, Large, X-Large) caps the compute one query can use and sets the minimum you are billed for while the warehouse is up; **Autoscaling** is a maximum measured in **DBUs rather than clusters**, independent of query size. Connectivity is the Statement Execution API only, so a driver using the legacy Thrift protocol gets a `501`. Usage bills under `sku_name` `Lakehouse_Serverless`, and you cannot convert a warehouse into one or out of one.

### Channels

Two channels always exist. New compute versions land in **Preview** first and are typically promoted to **Current** about two weeks later. Security features, maintenance updates and bug fixes can go straight to Current. Rollout is staged, so your account may not see a version until a week or more after its release date.

As of 12 September 2026, Current is Databricks SQL **2026.15** and Preview is **2026.20**.

Databricks recommends against running production workloads on a preview warehouse, and there is a practical catch: only workspace admins can see a warehouse's properties, so a normal user cannot tell which channel they are querying. The documented workaround is to say it in the warehouse name. Anyone can check the version from SQL:

```sql
SELECT current_version().dbsql_version;
```

## Example: a preview twin of the production warehouse

Declaring both warehouses in a bundle keeps them identical apart from the channel, which is the only way a comparison means anything:

```yaml
resources:
  sql_warehouses:
    bi_current:
      name: bi-serverless
      cluster_size: Small
      warehouse_type: PRO # with enable_serverless_compute, this is how you ask for serverless
      enable_serverless_compute: true
      auto_stop_mins: 10
      min_num_clusters: 1
      max_num_clusters: 4

    bi_preview:
      name: bi-serverless-PREVIEW-CHANNEL # non-admins cannot see the channel, so put it in the name
      cluster_size: Small
      warehouse_type: PRO
      enable_serverless_compute: true
      auto_stop_mins: 5
      min_num_clusters: 1
      max_num_clusters: 1
      channel:
        name: CHANNEL_NAME_PREVIEW
```

The twin costs nothing while it sleeps. Before a release, point the dashboard's heaviest dataset at it and compare results and timings with Current: a difference gives you roughly two weeks of notice. `channel.name` also accepts `CHANNEL_NAME_CUSTOM`, which pins a specific version through the `dbsql_version` field.

## Common mistakes

- **Choosing pro because serverless feels like the small option.** Pro costs about four minutes on every cold start, which is why its auto-stop default is 45 minutes, which is why it bills all day. For interactive BI that is usually the expensive choice, not the cautious one.
- **Expecting Predictive IO on classic, or Intelligent Workload Management on pro.** Those are the two lines in the matrix. A pro warehouse scales on the fixed rule of one cluster per 10 concurrent queries, not on predicted demand.
- **Creating warehouses through the API and getting classic.** The API default is classic even in a workspace whose UI defaults to serverless. Set `enable_serverless_compute` and `warehouse_type` explicitly.
- **Leaving a preview-channel warehouse in the picker with an ordinary name.** Non-admins cannot see the channel, so somebody will point a production dashboard at it.
- **Treating Lakehouse Real-Time as a faster serverless warehouse.** It is read-only and ANSI-only. Validate the query on serverless first, then move it.
- **Comparing Preview against Current on differently sized warehouses.** Any timing difference you measure is the size, not the version.

> [!exam]
> The Data Analyst Associate guide asks you to explain the role a SQL warehouse plays in query execution, and it covers Photon separately under Analyzing Queries. Learn the three generally available names (**serverless**, **pro**, **classic**) and the two features that separate them: classic has no **Predictive IO**, and **Intelligent Workload Management** is serverless only. The other reliable distinction is startup, seconds against minutes, because serverless compute runs in the Databricks account rather than yours. Channels and Lakehouse Real-Time are not on any exam guide.
