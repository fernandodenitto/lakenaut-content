---
id: data-layout-partitioning-zorder
title: Partitioning, Z-order, and data skipping
area: delta-lake
level: intermediate
summary: Partitioning, ZORDER BY, file-skipping statistics and file size tuning are the layout toolkit that predates liquid clustering, which replaces the first two and cannot be combined with either.
prerequisites: [delta-lake-overview, liquid-clustering]
related:
  [
    liquid-clustering,
    delta-optimize-vacuum,
    predictive-optimization,
    spark-ui-bottlenecks,
    query-profile,
  ]
exams:
  - cert: de-professional
    domain: "Data Modeling"
    objective: "Identify the benefits of using Liquid Clustering over partitioning and Z-Order."
  - cert: de-associate
    domain: "Troubleshooting, Monitoring, and Optimization"
    objective: "Liquid Clustering and predictive optimization."
sources:
  - url: https://docs.databricks.com/aws/en/delta/clustering
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/tables/partitions
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/tables/tune-file-size
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/delta/data-skipping
    checked: 2026-09-12
aliases:
  [
    PARTITIONED BY,
    ZORDER BY,
    z-order,
    zorder,
    data skipping,
    dataSkippingNumIndexedCols,
    targetFileSize,
    ingestion time clustering,
    REPLACE PARTITIONED BY WITH CLUSTER BY,
  ]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

Before [[liquid-clustering]], getting a Delta table to read quickly meant four separate levers, and you operated all of them yourself:

- **Partitioning**, declared with `PARTITIONED BY`, which puts each distinct value of a column in its own directory.
- **Z-ordering**, applied by `OPTIMIZE ... ZORDER BY`, which reorders rows inside files so related values sit together.
- **Data skipping statistics**, collected per file on write, which let the engine drop files without opening them.
- **File size tuning**, which decides how many files there are in the first place.

Liquid clustering replaces the first two and is **not compatible with either**. The last two remain, unchanged and still load-bearing. This page is the old model, because it is what a large inherited table is built on and what an exam still asks about.

## Why it exists

Partitioning arrived from Hive, where a directory per day was the only way to avoid scanning everything. It is a static commitment: you choose the columns when the table is created, and changing them means rewriting the table. Z-order was the answer to the cardinality problem partitioning could not solve, but it needs a full `OPTIMIZE` run to apply, and it works inside partition boundaries rather than through them.

Both were right for their time, and both are the wrong default now. The interesting question is no longer which to choose but how to get off them, which is the second half of this page.

## How it works

### Data skipping statistics

Statistics are collected automatically when you write to a Delta Lake or managed Iceberg table: per file, the minimum and maximum value, the null count, and the record count. At query time they let the engine skip files whose ranges cannot match the predicate. Nothing else on this page works without them, Z-order included. Which columns get them depends on the table type:

| Table type                                                       | Columns with statistics                                          |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| Unity Catalog **external** table                                 | the first **32 columns** in schema order                         |
| Unity Catalog **managed** table with [[predictive-optimization]] | the columns your queries filter on most, with no 32-column limit |

Without predictive optimization, two properties override the 32-column default: `delta.dataSkippingNumIndexedCols`, on all runtimes and still driven by column order, and `delta.dataSkippingStatsColumns`, from Databricks Runtime 13.3 LTS, which names columns explicitly and supersedes the other. Changing either affects future writes only; from Runtime 14.3 LTS, `ANALYZE TABLE <name> COMPUTE DELTA STATISTICS` recomputes existing data. Long strings are truncated during collection.

### Partitioning, and the sizes that make it defensible

The thresholds are published, and they are much higher than most teams assume:

| Table size       | Recommendation                                                      |
| ---------------- | ------------------------------------------------------------------- |
| under 1 TB       | do not partition                                                    |
| 1 TB to 100 TB   | use liquid clustering; partitioning more often hurts than helps     |
| 100 TB and above | partitioning might help, but try liquid clustering first and verify |

Each partition should hold at least 1 GB, and fewer, larger partitions outperform many small ones. Most tables under 100 TB need no partitioning at all, because unpartitioned Delta tables get **ingestion time clustering** for free, comparable to partitioning on a datetime column with nothing to tune. Heavy `UPDATE` or `MERGE` traffic erodes that, and the fix is clustering on a column that tracks ingestion order, not partitions.

Partition columns must be top level and scalar. Structs, maps, arrays and variants are out, and so are struct fields, since `PARTITIONED BY (s.field)` is read as an expression rather than a column reference. Clustering is the only way to skip on a struct field without promoting it first.

### Z-order

```sql
OPTIMIZE main.silver.orders
WHERE order_date >= current_date() - INTERVAL 1 DAY
ZORDER BY (customer_id);
```

Z-order suits high-cardinality columns that appear in predicates, which is exactly where partitioning fails. The constraints that matter:

- It only colocates **within a partition**, because files cannot be combined across partition boundaries. On an unpartitioned table it works across the whole table.
- You **cannot** Z-order on a column used for partitioning.
- Effectiveness drops with each column added to the list, and it is wasted compute on columns without statistics.
- It is **not idempotent**, although it aims to be incremental. Re-running it on a partition that received no new data does nothing.
- It balances output files by row count rather than bytes, so a table whose recent rows are wider gets skewed `OPTIMIZE` task times.

### File size

Target file size is autotuned from table size: 256 MB under 2.56 TB, growing linearly to 1 GB between 2.56 TB and 10 TB, and 1 GB above that. Setting `delta.targetFileSize` (or `iceberg.targetFileSize`) pins it and turns autotuning off. When the autotuned target grows, `OPTIMIZE` does not rewrite existing files into larger ones, so a big table keeps some files below target unless you pin a value. Managed tables are tuned automatically, and there only `OPTIMIZE` respects `targetFileSize`. See [[delta-optimize-vacuum]].

### Migrating to clustering keys

From Databricks Runtime 18.1, a partitioned Delta table converts in place:

```sql
ALTER TABLE <name> REPLACE PARTITIONED BY WITH CLUSTER BY [ ( <columns> ) | AUTO ];
```

Explicit columns should stay close to the old partition columns, because very different keys trigger a large reclustering on the first `OPTIMIZE`. `AUTO` starts from the current partition columns and lets predictive optimization evolve them, on managed tables only. With no options, the current partition columns become the keys. After conversion the table reads on Runtime 13.3 LTS and above, with 15.4 LTS recommended for workloads active during the conversion. Managed Iceberg tables need none of this, and the command errors: Unity Catalog already treats their `PARTITION BY` columns as clustering keys.

Which keys to pick depends on what the table used before:

| Current technique                                                                 | Clustering keys                                       |
| --------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Hive-style partitioning                                                           | the partition columns                                 |
| Z-order                                                                           | the `ZORDER BY` columns                               |
| Both                                                                              | the partition columns **and** the `ZORDER BY` columns |
| A generated column to reduce cardinality, such as a date derived from a timestamp | the original column, and drop the generated column    |

For the classic "partitioned by `event_date`, Z-ordered on `customer_id`" table, hierarchical clustering (Runtime 17.1 and above) reproduces the intent: `delta.liquid.hierarchicalClusteringColumns` prioritises the low-cardinality date and leaves the id a standard key.

## Example: converting a partitioned, Z-ordered orders table

The table was `PARTITIONED BY (order_date)` and maintained nightly with `OPTIMIZE ... ZORDER BY (customer_id)`, so both columns become clustering keys:

```sql
DESCRIBE DETAIL main.silver.orders;   -- partitionColumns, numFiles, sizeInBytes

ALTER TABLE main.silver.orders
  REPLACE PARTITIONED BY WITH CLUSTER BY (order_date, customer_id);

-- keep the date prioritised, as the partition layout effectively did
ALTER TABLE main.silver.orders
  SET TBLPROPERTIES ('delta.liquid.hierarchicalClusteringColumns' = 'order_date');

-- nothing moves until OPTIMIZE runs
OPTIMIZE main.silver.orders;
DESCRIBE DETAIL main.silver.orders;   -- clusteringColumns is now populated
```

If the partition column is a `TIMESTAMP` rather than a `DATE`, the conversion fails while trying to auto-generate statistics for an unsupported type. Disable that step and compute the statistics afterwards:

```sql
SET spark.databricks.delta.liquidConversion.statsGeneration.enabled = false;
ALTER TABLE main.silver.events
  REPLACE PARTITIONED BY WITH CLUSTER BY (event_ts, device_id);
ANALYZE TABLE main.silver.events COMPUTE DELTA STATISTICS;
```

## Common mistakes

- **Partitioning a 200 GB table by date "for performance".** Below 1 TB partitioning argues against itself, and ingestion time clustering already covers what the date partition was for.
- **Partitioning on a high-cardinality column.** Thousands of directories holding a few megabytes each, and a fix that costs a full rewrite.
- **`ZORDER BY` on a column with no statistics.** Data skipping needs per-file min, max and count. Without them the `OPTIMIZE` burns compute and changes nothing.
- **Trying to Z-order a partition column.** It is not allowed, and the instinct behind it usually means the partition column was the wrong choice.
- **Converting to clustering keys unrelated to the old partition columns.** The first `OPTIMIZE` then reclusters everything, the expensive outcome in-place conversion exists to avoid.
- **Pinning `delta.targetFileSize` on a managed table.** You lose autotuning permanently, for a number that was right on the day you set it.

> [!exam]
> Both guides test the contrast, not the commands. Partitioning is **static**, suits low or known cardinality, and is fixed at creation. `ZORDER BY` runs inside `OPTIMIZE`, handles high cardinality, is **not idempotent**, cannot target a partition column, and needs statistics on its columns. Liquid clustering replaces both and **cannot be combined with either**. Remember the thresholds: no partitioning under 1 TB, clustering from 1 TB to 100 TB, partitions of 1 GB or more. For a migration question, the answer is the partition columns plus the `ZORDER BY` columns as clustering keys.
