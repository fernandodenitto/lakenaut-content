---
id: delta-optimize-vacuum
title: "OPTIMIZE, VACUUM, and file layout"
area: delta-lake
level: intermediate
summary: OPTIMIZE compacts small files, VACUUM removes ones no version needs after a 7-day default retention, and predictive optimization now runs both for you.
prerequisites: [delta-lake-overview, liquid-clustering]
related: [liquid-clustering, delta-time-travel, spark-ui-bottlenecks]
exams:
  - cert: de-associate
    domain: "Troubleshooting, Monitoring, and Optimization"
    objective: "Understand the features of Liquid Clustering and predictive optimization."
sources:
  - url: https://docs.databricks.com/aws/en/delta/optimize
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/delta/vacuum
    checked: 2026-09-10
aliases: [OPTIMIZE, VACUUM, ZORDER BY, small files, auto compaction, optimized writes, bin-packing]
updated: 2026-09-10
status: published
---

## What it is

`OPTIMIZE` and `VACUUM` are the two file-maintenance commands every Delta table (see [[delta-lake-overview]]) eventually needs. `OPTIMIZE` **compacts** many small data files into fewer, larger ones and, optionally, reorders their contents for faster filtering. `VACUUM` **deletes** data files that no version still in the retention window needs anymore. One makes reads faster, the other reclaims storage.

## Why it exists

Streaming appends, frequent small batch jobs, and highly partitioned tables all produce the **small file problem**: thousands of tiny Parquet files where a handful of large ones would do. Listing them, opening them, and scheduling one task per file all cost time that has nothing to do with how much data you're actually reading. On the other side, every `UPDATE`, `DELETE`, `MERGE`, and `OPTIMIZE` leaves the old files behind — Delta needs them for time travel (see [[delta-time-travel]]) — so storage grows unless something eventually cleans them up.

## How it works

### OPTIMIZE and bin-packing

```sql
OPTIMIZE main.silver.orders;
OPTIMIZE main.silver.orders WHERE order_date >= '2026-09-01';
```

`OPTIMIZE` bin-packs files toward a target size, is idempotent (running it twice does nothing extra the second time), and is non-destructive to readers: a query running before, during, or after sees a consistent version. It doesn't run itself — you either schedule it (a nightly job is the usual starting point) or hand it off to predictive optimization.

### ZORDER BY, and why it's legacy

```sql
OPTIMIZE main.silver.orders ZORDER BY (customer_id);
```

`ZORDER BY` colocates rows with similar values in the given columns inside the same files, so a filter on `customer_id` skips more files. It does the job, but every run rewrites the *entire* table, it has to be triggered by hand, and it can't be combined with [[liquid-clustering]]. Databricks now recommends Liquid Clustering for new tables instead — same goal, incremental cost, mutable keys.

### VACUUM

```sql
VACUUM main.silver.orders;                 -- default: 7-day retention
VACUUM main.silver.orders DRY RUN;         -- lists what would be deleted, deletes nothing
VACUUM main.silver.orders RETAIN 168 HOURS; -- explicit, same as the default
```

The default retention is **7 days**, matched to `delta.deletedFileRetentionDuration`. A safety check refuses a shorter retention outright, because a query or a time-travel read still in flight could be pointing at those files:

```sql
SET spark.databricks.delta.retentionDurationCheck.enabled = false;
VACUUM main.silver.orders RETAIN 0 HOURS;
```

Disabling the check is only safe once you've confirmed nothing — no long-running query, no time-travel read, no downstream job — depends on a window that wide.

### Auto compaction and optimized writes

Two write-time settings reduce how many small files show up in the first place, instead of cleaning them up afterward:

| Setting | When it runs | What it does |
| --- | --- | --- |
| `delta.autoOptimize.optimizeWrite` | during the write | repartitions data before writing so files land close to the target size, cutting down the count produced by many small write tasks |
| `delta.autoOptimize.autoCompact` | right after the write commits | runs a lighter, synchronous compaction pass on the files that write just produced |

```sql
ALTER TABLE main.silver.orders SET TBLPROPERTIES (
  delta.autoOptimize.optimizeWrite = true,
  delta.autoOptimize.autoCompact = true
);
```

Both add a little latency to the write in exchange for fewer follow-up `OPTIMIZE` runs, and are the default for Unity Catalog managed tables on current runtimes.

### Predictive optimization taking this over

On Unity Catalog managed tables, **predictive optimization** decides on its own when to run `OPTIMIZE`, `VACUUM`, and statistics collection, on serverless compute, with nothing to schedule. See [[liquid-clustering]] for how it's enabled and scoped at the account, catalog, schema, or table level — the mechanics there apply to `OPTIMIZE` and `VACUUM` exactly as described here.

## Example

Bringing an unmanaged table under control, the manual way, before letting predictive optimization take over:

```sql
OPTIMIZE main.silver.orders;
VACUUM main.silver.orders DRY RUN;
VACUUM main.silver.orders;

ALTER TABLE main.silver.orders SET TBLPROPERTIES (
  delta.autoOptimize.optimizeWrite = true,
  delta.autoOptimize.autoCompact = true
);
```

```python
spark.sql("OPTIMIZE main.silver.orders")
spark.sql("VACUUM main.silver.orders DRY RUN").show(truncate=False)
spark.sql("VACUUM main.silver.orders")
```

## Common mistakes

- Disabling the retention check to run `VACUUM RETAIN 0 HOURS` without checking for long-running readers first: it can corrupt an in-flight query.
- Running `ZORDER BY` on a table that already uses `CLUSTER BY`: the two are mutually exclusive, and Delta rejects it.
- Assuming `OPTIMIZE` runs on a schedule by itself: without a job or predictive optimization enabled, small files just keep accumulating.
- Turning on `autoCompact` and `optimizeWrite` and expecting them to replace `OPTIMIZE` entirely: they reduce the problem at write time, they don't reorganize files that already exist.
- Forgetting that predictive optimization only reaches Unity Catalog **managed** tables: external tables still need `OPTIMIZE` and `VACUUM` scheduled by hand.

> [!exam]
> Know the roles, not just the names: `OPTIMIZE` compacts (and optionally `ZORDER BY`), `VACUUM` deletes old files under a **7-day default** retention that a safety check protects. `ZORDER BY` is the legacy, full-rewrite way to cluster data; **Liquid Clustering** (`CLUSTER BY`) is the current recommendation, with incremental `OPTIMIZE` and mutable keys. **Predictive optimization** automates `OPTIMIZE`, `VACUUM`, and statistics on Unity Catalog managed tables — see [[liquid-clustering]] for exactly how it's enabled.
