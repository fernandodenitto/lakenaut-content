---
id: query-profile
title: Reading the query profile
area: query-history
level: intermediate
summary: The query profile turns a finished statement into a graph of operators and metrics for spotting scans, spills, and bad joins.
prerequisites: [spark-tuning-basics, spark-ui-bottlenecks]
related: [sql-warehouse-sizing, spark-ui-bottlenecks, liquid-clustering]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/sql/user/queries/query-profile
    checked: 2026-09-10
aliases: [query profile, query plan, query history, spill, shuffle]
updated: 2026-09-10
status: published
---

## What it is

**Query History** lists every statement run on a SQL warehouse, with duration, user, and status. Opening one and clicking **See query profile** shows a **query profile**: a directed graph of the operators the engine actually executed — scans, joins, aggregations, shuffles — each annotated with its own metrics. It is the SQL-warehouse equivalent of the Spark UI's stages and tasks (see [[spark-ui-bottlenecks]]), but built around the operators a SQL statement compiles into rather than raw Spark stages.

## Why it exists

A query duration tells you *that* something is slow, not *what*. The profile graph attributes time, rows, and bytes to each individual operator, so instead of guessing you can point at the one join or scan responsible for most of the runtime and fix that specific thing.

## How it works

### The graph

The profile renders the query plan as a DAG: each node is an operator, edges show data flowing between them. Clicking a node opens its detailed metrics; a side panel also summarizes the three tabs **Details** (overall stats), **Top operators** (the most expensive ones), and **Query text**.

### The metrics that matter

| Metric | What it tells you |
| --- | --- |
| Rows read vs. rows returned | a huge gap on a scan usually means a missing filter or missing pruning |
| Bytes read | how much data actually had to be touched — compare it to the table's total size |
| Files/partitions pruned | how much of the table the engine skipped based on filters and file statistics |
| Spill to disk | the operator's working set didn't fit in memory — undersized warehouse, skew, or an exploding join |
| Shuffle | rows moved between workers to co-locate data for a join or aggregation — expensive, and worse when one side is much larger than the other |
| Time spent / memory peak | which operator to optimize first |

### Spotting a missing filter

If a scan's **rows read** is close to the table's full row count while **rows returned** is tiny, the predicate isn't being pushed down or pruning isn't happening — check that the filter is on a clustering or partition column, and that it isn't wrapped in a function that defeats pruning (`WHERE YEAR(order_date) = 2026` instead of a direct range on `order_date`).

### Spotting a bad join

A join with a much larger **rows out** than the sum of its inputs is an **exploding join**: a many-to-many match on a key that should be unique on at least one side. Heavy **shuffle** and **spill** on a join usually mean the smaller side didn't get broadcast, or one join key is heavily skewed.

### Photon

Photon-executed operators report their own metrics; some non-Photon operators are grouped together and share combined metrics rather than being broken out individually, so a profile from a Photon-enabled warehouse can look coarser in places than a fully vectorized breakdown.

## Example

Two versions of the same aggregation — compare their profiles rather than their SQL:

```sql
-- 1) No filter: full scan, rows read ≈ table size, no pruning
SELECT customer_id, SUM(amount) AS total
FROM sales.gold.orders
GROUP BY customer_id;
```

```sql
-- 2) Filtered on the clustering column: files pruned, rows read shrinks
SELECT customer_id, SUM(amount) AS total
FROM sales.gold.orders
WHERE order_date >= DATE'2026-01-01'
GROUP BY customer_id;
```

In the first profile, the scan operator shows most files read and no pruning; in the second, the same scan shows a high pruning percentage and a much smaller **bytes read**, with less downstream work for the aggregation.

## Common mistakes

- Looking only at total query duration instead of which operator owns most of the time.
- Ignoring the gap between rows read and rows returned — the clearest sign of a missing or ineffective filter.
- Not checking **spill to disk**, then concluding the query is "just slow" instead of undersized or skewed.
- Treating queueing time (waiting for a free cluster, see [[sql-warehouse-sizing]]) as part of the query's own execution time.
- Assuming Photon's grouped metrics mean an operator did nothing, when it's simply reported together with neighboring steps.

> [!tip]
> Before resizing a warehouse, open the profile: a scan with no pruning or a join that explodes rows will still be slow on a bigger warehouse, just slow with more DBUs consumed.
