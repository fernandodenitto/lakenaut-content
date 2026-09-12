---
id: spark-ui-bottlenecks
title: "Spark UI: skew, shuffle, and spill"
area: compute
subarea: performance
level: intermediate
summary: A stage's summary metrics in the Spark UI (min, median, max for duration, shuffle, and spill) tell you whether a job is slow because of skew, too much shuffle, or disk spill, and point to the fix.
prerequisites: [compute-options, spark-tuning-basics]
related: [spark-tuning-basics, cluster-troubleshooting, runs-monitoring, dataframe-joins-unions, liquid-clustering]
exams:
  - cert: de-associate
    domain: "Troubleshooting, Monitoring, and Optimization"
    objective: "Identify common performance bottlenecks such as data skew, shuffling, and disk spilling by interpreting stage-level metrics in the Spark UI."
sources:
  - url: https://docs.databricks.com/aws/en/optimizations/spark-ui-guide/
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/optimizations/spark-ui-guide/long-spark-stage-page
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/compute/troubleshooting/debugging-spark-ui
    checked: 2026-09-09
aliases: [spark ui, data skew, shuffle, spill, stage metrics, summary metrics]
updated: 2026-09-09
status: published
---

## What it is

The **Spark UI** is Apache Spark's diagnostic interface, reachable from a cluster's *Spark UI* tab or from a task's detail view in a run (see [[runs-monitoring]]). It shows how Spark broke your code down into **job → stage → task**, and, for each stage, how metrics are distributed across tasks. Three patterns explain most slow stages: **skew** (a few tasks holding much more data than the rest), excessive **shuffle** (data moved across the network between executors), and **spill** (not enough execution memory, so data gets written to disk).

## Why it exists

A DataFrame is declarative: you write a join and Spark decides how to execute it. When it's slow, the code doesn't tell you why. The Spark UI shows what actually happened: how many tasks, how much they read, how long the slowest one took. Without these metrics, tuning (see [[spark-tuning-basics]]) is just guessing.

## How it works

### Job, stage, task

An action (`write`, `count`, `display`) creates a **job**. Spark cuts it into **stages** at every shuffle boundary (join, `groupBy`, `repartition`, window). Each stage runs as N **tasks** in parallel, one per partition. The *Jobs* tab shows the timeline; the *Stages* tab lists stages with their duration and volumes; a stage's detail view has the **Summary Metrics** table.

### Reading the summary metrics

For each metric, the table reports **min, 25th percentile, median, 75th percentile, max** across the stage's tasks. The signal isn't the absolute value but the **shape of the distribution**.

| Metric | Healthy distribution | Symptom |
| --- | --- | --- |
| Duration | max close to the 75th percentile | max much higher than the median → skew |
| Shuffle Read Size / Records | similar across tasks | one task reads far more than the others → skew on the join or groupBy key |
| Shuffle Write | proportional to the data | huge total relative to the input → a join or aggregation moving everything |
| Spill (Memory) / Spill (Disk) | absent (zero) | any value at all → insufficient execution memory |
| GC Time | a small fraction of the duration | high → memory pressure on the executor |

Rule of thumb from the docs: if the duration's **max** exceeds the 75th percentile by more than 50%, suspect skew.

### The three symptoms

**Skew.** A key ("unknown" customer, `NULL`, a country that accounts for half the dataset) ends up in a single partition. Most tasks finish right away, one works for minutes, and the whole stage waits on it. In the UI: low median, very high max, and the same imbalance in *Shuffle Read Size*.

**Shuffle.** Moving data between executors is the most expensive phase: serialization, network, writes. A large *Shuffle Write* in one stage followed by a stage with many small partitions points to repeated joins and aggregations, or an unsuitable partitioning scheme.

**Spill.** When a task's execution memory isn't enough for its partition's sort or hash, Spark writes to disk (*Spill (Disk)*) the data it was holding in memory (*Spill (Memory)*, the deserialized size). A nonzero value means the task did the work twice. Spill and skew often go together: the bloated task is the one that spills.

### Fixes

| Problem | Fix | When |
| --- | --- | --- |
| Skew in a join | **AQE skew join** (`spark.sql.adaptive.skewJoin.enabled`, on by default on Databricks) | first thing to try, and it's free |
| Skew in a join | **broadcast** the small table (`broadcast()` or the `/*+ BROADCAST */` hint) | when the small side fits in driver and executor memory |
| Persistent skew | **salting**: add a random suffix to the key, explode the other side | joining two large tables on an unbalanced key |
| Skew from NULLs | filter out or isolate null keys before the join | many null keys |
| Spill | instances with more memory per core, fewer partitions per oversized task → `repartition` or a higher `spark.sql.shuffle.partitions` | spill in shuffle stages |
| Excessive shuffle | avoid unnecessary `repartition`, filter before joining, use [[liquid-clustering]] for data layout | shuffle volumes far larger than the input |

Joins and their strategies are covered in [[dataframe-joins-unions]].

## Example

A join stage has 200 tasks. Summary metrics:

| | Min | Median | 75th | Max |
| --- | --- | --- | --- | --- |
| Duration | 8 s | 30 s | 40 s | 10 min |
| Shuffle Read Size | 40 MB | 60 MB | 80 MB | 5 GB |
| Spill (Disk) | 0 | 0 | 0 | 3.2 GB |

Reading it: 199 tasks finish in under a minute, one takes ten; that task reads 5 GB against a median of 60 MB, and it spills. This is **skew** on the join key, with spill as a consequence. The fix isn't a bigger cluster (that would only help one task) but changing how the data is distributed:

```python
from pyspark.sql import functions as F

# 1. check which key is heavy
orders.groupBy("customer_id").count().orderBy(F.desc("count")).show(5)

# 2a. if the "customers" side is small: broadcast
res = orders.join(F.broadcast(customers), "customer_id")

# 2b. otherwise, salting: 16 sub-keys for the large side, explode the small side
n = 16
orders_s    = orders.withColumn("salt", (F.rand() * n).cast("int"))
customers_s = customers.withColumn("salt", F.explode(F.array([F.lit(i) for i in range(n)])))
res = orders_s.join(customers_s, ["customer_id", "salt"]).drop("salt")
```

```sql
-- the same broadcast in SQL
SELECT /*+ BROADCAST(c) */ o.*, c.segment
FROM orders o JOIN customers c ON o.customer_id = c.customer_id;
```

## Common mistakes

- Adding workers to a skewed stage: the slow task is still just one task, and it's still slow; the cost just goes up.
- Looking only at the stage's total duration and not the distribution: a 10-minute stage with 200 uniform tasks is a volume problem, not skew.
- Increasing `spark.sql.shuffle.partitions` to fix skew: more partitions don't split a single key apart.
- Ignoring a "small" spill: it signals that tasks are already at the edge of their memory budget, and the stage will collapse the next time data volume grows.
- Forcing a broadcast of a table that doesn't fit in memory: you trade a slow stage for a driver out of memory (see [[cluster-troubleshooting]]).

> [!exam]
> The typical question gives you numbers like the example: a median task of 30 seconds, one at 10 minutes, max shuffle read of 5 GB against a few MB. Answer: **data skew**, and the fix is to redistribute the key (AQE skew join, broadcast, salting), not add nodes. Know how to tell them apart: *max ≫ median* = skew; *Spill (Disk) > 0* = insufficient memory; huge *Shuffle Write* = too much data movement.
