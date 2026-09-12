---
id: query-performance-insights
title: Query performance insights
area: query-history
level: intermediate
summary: Databricks analyses every finished statement and returns named insights, each with a recommendation, plus a record of the accelerations it already applied on your behalf.
prerequisites: [query-profile]
related:
  [query-profile, sql-warehouse-sizing, liquid-clustering, predictive-optimization, genie-code]
exams:
  - cert: data-analyst-associate
    domain: "Analyzing Queries"
    objective: "Identify poorly performing queries in the Databricks Intelligence Platform, such as Query Insights and the Query Profiler log."
sources:
  - url: https://docs.databricks.com/aws/en/sql/user/queries/performance-insights
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-aux-analyze-table
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/delta/clustering
    checked: 2026-09-12
aliases:
  [
    query insights,
    performance insights,
    query recommendations,
    exploding join,
    data spill,
    applied accelerations,
    accelerated,
  ]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

When a statement finishes, Databricks reads its own execution and returns **performance insights**: named findings, each with a recommendation you can act on, ranked by their estimated effect on total task duration. Some tell you what to change. Others, labelled **Accelerated**, tell you what the engine already did for you and need no action.

The distinction from [[query-profile]] is worth being precise about. The profile is what you read: operators, rows, bytes, spill. Insights are what the platform tells you, with a name you can search for and a recommended action. You still open the profile to confirm a diagnosis, but you no longer have to arrive at it unaided.

## Why it exists

Reading a profile is a skill, and most of the people looking at a slow dashboard do not have it. Insights encode the diagnoses an experienced engineer makes from the same graph, as named findings with an action attached, and rank them so you fix the expensive one rather than the first one you recognise.

They also close the loop in the other direction, which nothing else does. Without the Accelerated insights you cannot tell whether a query was fast because it is well written or because the engine broadcast a join based on measurements from previous runs, skipped most of the table thanks to clustering keys it chose itself, or pushed your query past a full queue because it predicted it would be short. That matters the day one of those stops happening.

## How it works

### Where they appear

In two places. **Query history** shows a summary of insights in the query details panel, ranked by estimated effect on total task duration. The **Performance insights** tab of the query profile shows the full detail for each one.

### Query optimisation insights: the query is the problem

| Insight                             | What it found                                                           | What to do                                                     |
| ----------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `COVERAGE_FILTER_KEYS_CLUSTERING`   | the table is clustered by keys your filters do not use                  | filter on the clustering keys to cut bytes read                |
| `COVERAGE_FILTER_KEYS_PARTITIONING` | the table is partitioned by keys your filters do not use                | filter on the partitioning keys                                |
| `COVERAGE_PHOTON`                   | Photon cannot accelerate an operation, so it ran on the standard engine | check the Photon limitations and rewrite onto a supported path |
| `EXPLODING_JOIN`                    | the join produces far more rows than it reads                           | fix the join condition, or cut input rows on both sides        |
| `FLOW_FULL_RECOMPUTE`               | the flow ran as a full recompute                                        | rewrite it so it can refresh incrementally                     |
| `REDUNDANT_AGGREGATION`             | an aggregate did not change the result                                  | remove it, or declare primary and foreign key constraints      |
| `REDUNDANT_JOIN`                    | an outer join changed no row count and none of its columns are used     | remove it, or declare primary key or unique constraints        |
| `SELECTIVE_JOIN`                    | the join produces far fewer rows than it reads                          | filter before the join instead of after it                     |
| `WIDE_PROJECTION`                   | the query selects every column                                          | project only the columns you need                              |

`REDUNDANT_AGGREGATION` and `REDUNDANT_JOIN` are the two worth dwelling on, because the recommendation is not only "delete code". Both can be fixed by telling the optimiser about a key it cannot see: a declared primary key or unique constraint lets it prove the join or the `DISTINCT` was unnecessary and drop the operator itself.

### Data layout insights: the table is the problem

| Insight                    | What it found                                                                              | What to do                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `CONCURRENT_WRITE`         | concurrent writes are conflicting, resolved or failed                                      | read the Delta history and reschedule the writers                                                |
| `COVERAGE_STATS_DELTA`     | data-skipping statistics are missing or incomplete, so filtering happened inside the files | collect Delta statistics                                                                         |
| `COVERAGE_STATS_OPTIMIZER` | cost-based optimiser statistics are missing, so the plan came from heuristics              | collect statistics                                                                               |
| `DATA_FILE_SIZE`           | the scan reads many small files                                                            | enable predictive optimization, run `OPTIMIZE`, or move a partitioned table to liquid clustering |
| `DATA_SKEW`                | work is distributed unevenly across the compute                                            | salt the key or pre-aggregate                                                                    |
| `MANUAL_DATA_LAYOUT`       | the table is hand-tuned and would benefit from automatic clustering                        | convert external to managed, enable predictive optimization, enable automatic clustering         |

`COVERAGE_STATS_DELTA` reports a status per filter, and the fourth value is the one that misleads people: **Full**, **Partial**, **Unavailable**, and **Unused**, where Unused means the statistics exist but the filter cannot use them because it converts the data type. No amount of `ANALYZE` fixes Unused. The predicate is the bug.

`DATA_FILE_SIZE` carries a caveat in the same direction: on a partitioned table, predictive optimization cannot compact small files across partitions, so the recommendation is to move the table to liquid clustering rather than to keep running `OPTIMIZE` (see [[liquid-clustering]] and [[predictive-optimization]]).

### Compute and resource insights: the warehouse is the problem

| Insight                | What it found                                  | What to do                                                               |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| `DATA_SPILL`           | data did not fit in memory and spilled to disk | increase the warehouse size, or read fewer rows, columns or large values |
| `EXCESSIVE_QUEUE_TIME` | the query sat in the warehouse queue           | raise the maximum number of clusters                                     |
| `IO_THROTTLING`        | the cloud provider throttled a storage request | ask your administrator to raise the storage request limits               |

These three are the clearest illustration of why the distinction in [[sql-warehouse-sizing]] matters. `DATA_SPILL` is a size problem. `EXCESSIVE_QUEUE_TIME` is a cluster-count problem. The same bigger-warehouse reflex fixes one and wastes money on the other.

### Applied accelerations

Three insights appear with an **Accelerated** label and need no action:

- `AUTO_LIQUID_CLUSTERING`: the query read less data because its tables are clustered by keys Databricks learned from the workload.
- `HISTORY_BASED_JOIN_STRATEGY`: the engine chose a broadcast join instead of a shuffle, based on measurements from previous runs of similar queries.
- `SHORT_QUERY_PRIORITIZATION`: the cluster was at capacity, the engine predicted this query was short, and ran it immediately on a fast path instead of queueing it behind heavier work.

### Acting on one with Genie Code

Where insights are actionable, **Optimize** opens [[genie-code]]. For the ones that need a query change it rewrites the query and presents the diff for your approval; for the ones that need a table or compute change it summarises the recommended actions in plain language, because it cannot run an `ALTER TABLE` on your behalf without you asking.

## Example: a query that collects four insights

The query below reads every column, filters on a column the table is not clustered by, and applies its only selective predicate after the join:

```sql
-- WIDE_PROJECTION, COVERAGE_FILTER_KEYS_CLUSTERING, SELECTIVE_JOIN
SELECT o.*, c.*
FROM main.gold.orders o
JOIN main.gold.customers c ON c.customer_id = o.customer_id
WHERE c.country = 'IT';
```

Rewritten: filter on the clustering key of the large table, push the country filter below the join, and project the four columns the report actually renders.

```sql
SELECT o.order_id, o.order_date, o.amount, c.customer_name
FROM main.gold.orders o
JOIN (
  SELECT customer_id, customer_name
  FROM main.gold.customers
  WHERE country = 'IT'
) c ON c.customer_id = o.customer_id
WHERE o.order_date >= DATE '2026-09-01';
```

The fourth insight is not in the query at all. `COVERAGE_STATS_OPTIMIZER` and `DATA_FILE_SIZE` are properties of the table, and the actions live there:

```sql
-- COVERAGE_STATS_OPTIMIZER: give the cost-based optimiser something to plan with
ANALYZE TABLE main.gold.orders COMPUTE STATISTICS FOR ALL COLUMNS;

-- DATA_FILE_SIZE and MANUAL_DATA_LAYOUT: let the platform choose keys and compact files
ALTER TABLE main.gold.orders CLUSTER BY AUTO;
```

Run the query again afterwards and read the insight list, not the wall clock. If `COVERAGE_FILTER_KEYS_CLUSTERING` has gone and `SELECTIVE_JOIN` has gone, the rewrite worked, whatever the timing says about a warm cache.

## Common mistakes

- **Reading `COVERAGE_STATS_DELTA` status Unused as missing statistics.** Unused means the filter converts the data type so the statistics cannot apply. Running `ANALYZE` changes nothing; fixing the predicate does.
- **Raising the warehouse size on `EXCESSIVE_QUEUE_TIME`.** Queueing is solved by more clusters. A bigger size makes each query faster and the queue no shorter.
- **Ignoring the ranking.** Insights are ordered by estimated effect on total task duration. Fixing the third one because you understand it best is how an afternoon disappears for a two per cent gain.
- **Treating an Accelerated insight as a problem to fix.** `SHORT_QUERY_PRIORITIZATION` is not a warning that your query was queued; it is the record that it was not.
- **Accepting a Genie Code rewrite without checking the rows.** Removing a redundant join or projecting fewer columns changes the result set if the insight's assumption about uniqueness is wrong. Compare counts before you save the query.
- **Chasing `DATA_FILE_SIZE` with `OPTIMIZE` on a partitioned table, forever.** Predictive optimization cannot compact small files across partitions. The recommendation is to change the layout, not to run the command more often.

> [!exam]
> The Data Analyst Associate guide names **Query Insights** alongside the query profiler in the Analyzing Queries domain. Know that insights appear both in **query history** (summary in the query details panel) and in the **Performance insights** tab of the **query profile**, that they are ranked by estimated effect on total task duration, and that some are recommendations while others are **Accelerated** records of optimisations already applied. The two compute insights are the likeliest distinction to be tested: spill means increase the warehouse **size**, queue time means increase the **number of clusters**.
