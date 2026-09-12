---
id: spark-tuning-basics
title: Basic Spark tuning parameters
area: compute
level: intermediate
summary: The four Spark parameters the exam expects you to know, what AQE already does for you on Databricks, how to set them, how to measure the effect, and what's not available on serverless.
prerequisites: [compute-options, dataframe-joins-unions]
related: [spark-ui-bottlenecks, cluster-troubleshooting, liquid-clustering, runs-monitoring]
exams:
  - cert: de-associate
    domain: "Data Transformation and Modeling"
    objective: "Understand the basic tuning parameters (spark.sql.shuffle.partitions:, spark.default.parallelism, spark.executor/driver.memory, spark.sql.autoBroadcastJoinThreshold) and re-measure the performance."
sources:
  - url: https://docs.databricks.com/aws/en/optimizations/
    checked: 2026-09-09
  - url: https://spark.apache.org/docs/latest/sql-performance-tuning.html
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/spark/conf
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/compute/serverless/limitations
    checked: 2026-09-09
aliases: [shuffle partitions, AQE, adaptive query execution, spark conf, autoBroadcastJoinThreshold]
updated: 2026-09-09
status: published
---

## What it is

Spark exposes hundreds of configuration properties. Four families explain most of the performance issues in an ETL job: how many partitions a shuffle produces, how much parallelism low-level operations get, how much memory the driver and executors have, and below what threshold a join turns into a broadcast. **Tuning** is the loop of measure → change one parameter → measure again.

## Why it exists

Spark was designed for generic clusters, and its defaults (200 shuffle partitions, a 10 MB broadcast threshold) are compromises. On Databricks, many of them are already revisited: **Adaptive Query Execution (AQE)** is on by default, Photon speeds up execution, and serverless compute hides almost every knob. The exam wants you to know what each parameter does, but also when **not** to touch it.

## How it works

### The parameters

| Property | What it controls | OSS default | On Databricks |
| --- | --- | --- | --- |
| `spark.sql.shuffle.partitions` | number of partitions after a join, `groupBy`, or window | 200 | AQE coalesces them; `auto` picks the number based on the data (default on serverless) |
| `spark.default.parallelism` | default partitions for RDD operations (`parallelize`, transformations with no SQL shuffle) | total number of cores | rarely relevant: DataFrame and SQL use `shuffle.partitions` instead |
| `spark.executor.memory` / `spark.driver.memory` | JVM heap for executors and driver | 1 GB | derived from the node type; you change it by picking different instances, not with `spark.conf.set` |
| `spark.sql.autoBroadcastJoinThreshold` | maximum size of a table to be copied to every executor in a join | 10 MB | same default; `-1` disables it; AQE can broadcast at runtime |

**Too many shuffle partitions** on small data creates thousands of tiny tasks and small output files; **too few** on large data produces slow tasks that spill to disk (see [[spark-ui-bottlenecks]]). The rule of thumb is to aim for partitions of 100-200 MB.

**Memory**: driver out-of-memory errors almost always come from `collect()` or `toPandas()` on large data; executor OOMs come from skew or from broadcasting tables that are too large. Diagnosis is covered in [[cluster-troubleshooting]].

### AQE

AQE re-optimizes the plan during execution using real shuffle statistics: it coalesces small partitions (`coalescePartitions`), splits skewed ones (`skewJoin`), and converts a sort-merge join into a broadcast if it discovers one side is small. On Databricks it's on by default, which is why `spark.sql.shuffle.partitions` matters less than older tutorials suggest, and the first tuning step is to make sure nobody disabled it.

### Where to set them

| Level | How | Applies to |
| --- | --- | --- |
| Session | `spark.conf.set(...)` in Python, `SET key = value` in SQL | the current notebook or task |
| Cluster / job cluster | the cluster's "Spark config" field, or `spark_conf` in the bundle | everything running on the cluster |

Driver and executor memory are **static** properties: they belong in the cluster configuration, before startup; `spark.conf.set` at runtime has no effect on them.

### What's missing on serverless

On serverless, the platform manages sizing and memory. Only a handful of properties can be set, including `spark.sql.shuffle.partitions`, `spark.sql.session.timeZone`, `spark.sql.ansi.enabled`, and `spark.sql.files.maxPartitionBytes`. No `executor.memory`, no `default.parallelism`, and **there's no Spark UI**: you use the query profile instead. Tuning executor memory therefore requires a classic job cluster (see [[compute-options]]).

### How to measure

1. Run the job and note its duration and, in the Spark UI, the longest stage with its shuffle read/write and spill.
2. Change **one** parameter.
3. Rerun on the same data and compare. The run history (see [[runs-monitoring]]) is where you read the trend.

## Example

An aggregation over a table of a few GB produces 200 tiny files: measure first, then retry with fewer partitions and a higher broadcast threshold.

```sql
SET spark.sql.shuffle.partitions = 64;
SET spark.sql.autoBroadcastJoinThreshold = 52428800; -- 50 MB

SELECT channel, COUNT(*) AS n, SUM(amount) AS total
FROM shop.silver.orders o
JOIN shop.silver.customers c USING (customer_id)
GROUP BY channel;
```

```python
import time

spark.conf.set("spark.sql.shuffle.partitions", "64")
spark.conf.set("spark.sql.autoBroadcastJoinThreshold", str(50 * 1024 * 1024))

print(spark.conf.get("spark.sql.adaptive.enabled"))  # expected: true

t0 = time.time()
(spark.read.table("shop.silver.orders")
    .join(spark.read.table("shop.silver.customers"), "customer_id")
    .groupBy("channel").agg(F.count("*").alias("n"), F.sum("amount").alias("total"))
    .write.mode("overwrite").saveAsTable("shop.gold.orders_by_channel"))
print(f"duration: {time.time() - t0:.1f}s")
```

For memory, on the other hand, you change the job cluster:

```yaml
job_clusters:
  - job_cluster_key: etl
    new_cluster:
      node_type_id: r6i.xlarge     # memory-optimized nodes
      num_workers: 4
      spark_conf:
        spark.sql.shuffle.partitions: "auto"
        spark.driver.maxResultSize: "8g"
```

## Common mistakes

- Copying `spark.sql.shuffle.partitions = 2000` from a blog post without measuring: with AQE on it may not change anything, and with AQE off it produces tiny files.
- Setting `spark.executor.memory` with `spark.conf.set` in a notebook: it's silently ignored.
- Disabling broadcast (`-1`) "to be safe": small joins all turn into shuffles.
- Changing three parameters at once and not knowing which one helped.
- Looking for the Spark UI on serverless.

> [!exam]
> You need to match each parameter to its effect: `shuffle.partitions` → number of partitions after joins and aggregations; `default.parallelism` → RDD operations; `executor/driver.memory` → heap, configurable only at the cluster level; `autoBroadcastJoinThreshold` → the broadcast join threshold, `-1` disables it. Know that AQE is on by default on Databricks, that on serverless you can't set memory or see the Spark UI, and that tuning is a loop of measuring and repeating, not a one-time configuration.
