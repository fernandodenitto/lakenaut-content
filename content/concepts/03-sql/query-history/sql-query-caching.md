---
id: sql-query-caching
title: Query caching layers
area: query-history
level: intermediate
summary: "Databricks SQL has five caches, not one: the UI cache, the local and remote result caches, the disk cache and the AI/BI dashboard cache. Each has its own lifetime and its own invalidation rule."
prerequisites: [query-profile, sql-warehouse-sizing]
related:
  [
    query-profile,
    sql-warehouse-sizing,
    dashboards-overview,
    query-performance-insights,
    sql-warehouse-types-and-channels,
  ]
exams:
  - cert: data-analyst-associate
    domain: "Analyzing Queries"
    objective: "Use query history and caching to reduce development time and query latency."
sources:
  - url: https://docs.databricks.com/aws/en/sql/user/queries/query-caching
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/optimizations/disk-cache
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/dashboards/caching
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-parameters
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-aux-conf-mgmt-reset
    checked: 2026-09-12
aliases:
  [
    query cache,
    result cache,
    remote result cache,
    local cache,
    disk cache,
    delta cache,
    dashboard cache,
    use_cached_result,
  ]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

Between your statement and the data files there are five independent caches. Four of them hold query **results**; one holds **data files**. They have different owners, different lifetimes, and one of them can hand you a stale answer.

| Cache                   | Holds                                                | Scope                                      | Lifetime                                                                          | Survives a warehouse restart  | Serverless only |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- | ----------------------------- | --------------- |
| Databricks SQL UI cache | the last result of a saved query or legacy dashboard | per user                                   | at most 7 days                                                                    | yes, it is not on the cluster | no              |
| Local result cache      | query results, in memory                             | per cluster                                | the cluster's lifetime, or until the cache is full, and 24 hours from cache entry | no                            | no              |
| Remote result cache     | query results, as workspace system data              | shared by every warehouse in the workspace | 24 hours from cache entry                                                         | **yes**                       | **yes**         |
| Disk cache              | data files, on local SSD                             | per cluster                                | same as the local result cache                                                    | no                            | no              |
| AI/BI dashboard cache   | dashboard dataset results                            | shared or per user, see below              | 24 hours, best effort                                                             | yes                           | no              |

## Why it exists

The obvious reason is money: a repeated query that is served from a cache does not run, so the warehouse does not scale up and may not even start. The less obvious reason is that these five layers answer five different questions, and collapsing them into "the cache" is what makes people wrong about freshness.

Result caches exist so an identical statement does not execute twice. The disk cache exists so a statement you have never run before still avoids a round trip to object storage for files a neighbouring query already pulled. The remote result cache exists because an in-memory cache dies with the cluster, which on a serverless warehouse with a ten-minute auto-stop is most of the day. And the dashboard cache exists so opening a dashboard does not wake a warehouse, which is exactly why it is the one that can be stale.

## How it works

### Databricks SQL UI cache

Per user. When you open a saved query or a legacy SQL dashboard, this is what shows you the last result immediately, including results produced by a scheduled run. It lives in the Databricks filesystem in your account, has at most a **7-day** life cycle, and is invalidated once the underlying tables are updated. Re-running the query drops the old result from the cache.

It does **not** apply to AI/BI dashboards, which have their own cache described below.

### Result cache: local and remote

The **local result cache** is in memory on the cluster. It lasts the cluster's lifetime or until the cache fills up, whichever comes first, with a 24-hour life cycle per entry. Stopping or restarting the warehouse cleans it.

The **remote result cache** is serverless only. Results are persisted as workspace system data, so the cache is a **persistent shared cache across every warehouse in the workspace** and survives a warehouse stop or restart. It still needs a running warehouse to read from: a cluster checks its local cache first, then the remote result cache, and only executes the query if neither has it. It is available to ODBC and JDBC clients and to the Statement Execution API.

Both result caches carry a **24-hour** life cycle starting at cache entry, and both are invalidated when the underlying tables are updated. That is the guarantee worth remembering: a result cache never gives you stale data.

### Disk cache

The disk cache holds copies of remote Parquet data files, which includes Delta Lake tables, on the local SSDs of the compute nodes in a fast intermediate format. It is data, not results, so it speeds up a query that has never run before as long as it touches files something else already read. It detects when files are created, deleted, modified or overwritten and invalidates the stale entries itself, and it shares the local result cache's lifecycle: a stop or restart empties it.

On SQL warehouses, and on Databricks Runtime 14.2 and above, the `CACHE SELECT` command is ignored. There is nothing to prime by hand.

### AI/BI dashboard cache

This is the layer that behaves differently, and the one that generates support tickets. AI/BI dashboards keep a **24-hour result cache on a best-effort basis**, checked before the generic query result cache. The two invalidate differently:

- the query result cache never returns stale data, because a change to the underlying data invalidates its entries;
- the dashboard cache **can return results up to 24 hours old even when the underlying data has changed**, and a data change does not invalidate or refresh it.

Refreshing the table in a pipeline does not refresh the dashboard cache. The reliable way to refresh it is a dashboard **schedule**; otherwise it only updates when the dashboard runs a query the cache cannot serve. Serving from it does not start the SQL warehouse at all, which is the trade you are making. A dashboard published with shared data permissions gets one shared cache that every viewer sees; a draft, or a dashboard published with individual data permissions, gets a per-user cache (see [[dashboards-overview]]).

### Turning the result caches off

`USE_CACHED_RESULT` defaults to `TRUE`. It is settable per session but not globally, and Databricks is explicit that you should only turn it off for testing or benchmarking.

## Example: measuring a query honestly

The second run of an identical statement is a cache hit, so a naive before-and-after comparison always flatters whichever version you ran second:

```sql
-- Run 1: executes. Run 2 of the identical text: served from the result cache.
SELECT channel, SUM(amount) AS revenue
FROM main.gold.orders
WHERE order_date >= DATE '2026-09-01'
GROUP BY channel;

-- Take the result caches out of the picture, for this session only
SET use_cached_result = false;

SELECT channel, SUM(amount) AS revenue
FROM main.gold.orders
WHERE order_date >= DATE '2026-09-01'
GROUP BY channel;

-- Put the session back to the global default
RESET use_cached_result;
```

With `use_cached_result = false` the query really executes, but the disk cache is still holding the files, so a second run can still be faster than the first. That is the honest baseline for comparing two query shapes: both execute, both read warm files, and the difference you measure is the plan. Read the difference in the [[query-profile]] rather than on the clock.

## Common mistakes

- **Benchmarking two query variants with caching on.** The second one wins because it was identical to something already cached, or because the first one warmed the disk cache for it. Disable the result caches and run each one twice.
- **Assuming a dashboard shows fresh numbers after the pipeline ran.** The dashboard cache is the one layer that serves stale results, for up to 24 hours, and a write does not invalidate it. Give the dashboard a schedule.
- **Expecting the remote result cache on pro or classic.** It is serverless only. On pro and classic, the result cache dies with the cluster.
- **Thinking the disk cache holds results.** It holds data files, which is why a brand new query can be fast and why clearing your mind of "the cache" matters.
- **Leaving `use_cached_result = false` set.** It is session state, and a session outlives the statement that set it (see [[sql-warehouse-sessions]]). `RESET use_cached_result` when the measurement is done.
- **Treating the UI cache as a freshness guarantee.** It is per user, at most seven days old, and what it shows you may be the result of last night's scheduled run rather than anything you just did.

> [!exam]
> The Data Analyst Associate guide pairs query history with caching, and the distinctions it can test are the exact ones people flatten. Know that the **Databricks SQL UI cache is per user** with a 7-day maximum, that the **local result cache dies with the cluster** while the **remote result cache is serverless only and survives a stop or restart**, that both result caches expire **24 hours** after entry and are invalidated by a write to the underlying tables, and that the **disk cache stores data files, not results**. The statement to disable result reuse is `SET use_cached_result = false`.
