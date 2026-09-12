---
id: streaming-watermarks-state
title: Watermarks and stateful streaming
area: streaming
level: advanced
summary: A watermark bounds how long Structured Streaming waits for late data, so windowed aggregations, stream-stream joins, and deduplication can drop old state instead of growing forever.
prerequisites: [structured-streaming-basics, dataframe-dedup-aggregations]
related: [structured-streaming-basics, spark-tuning-basics, spark-ui-bottlenecks]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/structured-streaming/watermarks
    checked: 2026-09-10
aliases: [watermark, withWatermark, tumbling window, sliding window, session window, state store, RocksDB, dropDuplicatesWithinWatermark]
updated: 2026-09-10
status: published
---

## What it is

A **watermark** is a moving threshold on **event time** — the timestamp recorded inside each record, as opposed to **processing time**, when Spark happens to see it — that tells a stateful streaming query how late a record is allowed to be before it's ignored. Anything stateful — a windowed aggregation, a stream-stream join, deduplication — needs to know when it's safe to stop waiting for more data for a given key or window, and the watermark is that signal.

## Why it exists

A stateful query keeps, for every open group or window, whatever it needs to update the result later: partial sums, rows buffered waiting for a join partner. Without a way to say "no data older than this is coming," that state only grows: every key and window stays open forever, and the job eventually exhausts memory or disk on the state store. The watermark gives Spark permission to close old state and move on.

## How it works

### Declaring it

```python
events.withWatermark("event_time", "10 minutes")
```

This says: once the engine has seen an event with timestamp *T*, it will keep accepting records with `event_time` down to *T − 10 minutes*, and drop or ignore anything older for stateful purposes. The threshold advances based on the maximum event time seen so far, not on wall-clock time.

### Windowed aggregations

| Window type | Shape | How it's declared |
| --- | --- | --- |
| **Tumbling** | fixed-size, non-overlapping | `window(event_time, "1 hour")` |
| **Sliding** | fixed-size, overlapping | `window(event_time, "1 hour", "15 minutes")` (window length, slide) |
| **Session** | dynamic, closes after a gap of inactivity | `session_window(event_time, "10 minutes")` |

All three need `withWatermark` upstream in `append` mode: without it, Spark has no way to know a window is finished, so it never emits a final row.

### Stream-stream joins

Joining two streams means buffering rows from each side until a matching row shows up on the other. Watermarks on both sides, combined with a time-range join condition, let Spark evict buffered rows once they're too old to match anything: **required** for outer joins (otherwise an unmatched row could never be emitted), and strongly recommended for inner joins to bound the state.

### Deduplication

`dropDuplicates(["order_id"])` alone keeps every distinct key forever. `dropDuplicatesWithinWatermark(["order_id"])` combines deduplication with the watermark, so a key can be evicted from state once it falls outside the watermark window — the right choice whenever the column you dedup on isn't the event-time column itself.

### State store, RocksDB, and rebalancing

Between micro-batches, state lives in the **state store**, checkpointed alongside offsets. The default in-memory provider works for small state; **RocksDB** (`spark.sql.streaming.stateStore.providerClass`) is recommended once state gets large, since it spills to local disk instead of the JVM heap. When a streaming query scales its cluster up or down, state **rebalancing** redistributes state partitions across the new executors so no single task owns a disproportionate share.

### Spotting state that grows without bound

Symptoms: checkpoint size climbing steadily, `stateOperators` metrics in the streaming query progress log showing `numRowsTotal` that never plateaus, or growing processing time per batch with no growth in input volume. The usual causes are a missing watermark, a watermark delay set far longer than the data actually needs, or a single skewed key/partition holding a straggler event that keeps the whole watermark from advancing.

## Example

Tumbling-window revenue with a 15-minute watermark:

```python
from pyspark.sql import functions as F

(events
  .withWatermark("event_time", "15 minutes")
  .groupBy(F.window("event_time", "1 hour"), "channel")
  .agg(F.sum("amount").alias("revenue"))
  .writeStream
  .outputMode("append")
  .option("checkpointLocation", "/Volumes/shop/streaming/_checkpoints/revenue")
  .toTable("shop.gold.revenue_by_hour"))
```

```sql
CREATE OR REFRESH STREAMING TABLE shop.gold.revenue_by_hour
AS SELECT window(event_time, '1 hour') AS hour, channel, SUM(amount) AS revenue
FROM STREAM shop.silver.events
GROUP BY window(event_time, '1 hour'), channel;
```

A stream-stream join with a watermark and a time-range condition on both sides:

```python
orders_wm = orders.withWatermark("order_time", "1 hour")
shipments_wm = shipments.withWatermark("ship_time", "2 hours")

joined = orders_wm.join(
    shipments_wm,
    F.expr("""
        order_id = shipment_order_id AND
        ship_time BETWEEN order_time AND order_time + INTERVAL 2 HOURS
    """)
)
```

## Common mistakes

- Aggregating in `append` mode without `withWatermark`: the query either fails at start or never emits a row, since Spark can't tell when a group is done.
- Using `dropDuplicates` instead of `dropDuplicatesWithinWatermark` for a non-event-time key: state for old keys never gets evicted.
- Setting the watermark delay too tight for the actual lateness of the source, silently dropping records that arrive a few minutes late.
- Joining two streams with only one side watermarked, or without a time-range condition: state on the other side keeps every row indefinitely.
- Assuming a bigger cluster fixes runaway state growth, when the real cause is a missing or too-generous watermark.

> [!tip]
> The watermark delay is a business decision, not a technical default: it's the answer to "how late can a record legitimately be before I'd rather drop it than wait for it." Set it too short and you lose real data; too long and you pay for state you'll almost never need.
