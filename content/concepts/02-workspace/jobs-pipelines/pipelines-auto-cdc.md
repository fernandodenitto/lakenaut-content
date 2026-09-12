---
id: pipelines-auto-cdc
title: Change data capture with AUTO CDC
area: jobs-pipelines
subarea: pipelines
level: advanced
summary: AUTO CDC and AUTO CDC FROM SNAPSHOT apply a change feed or a sequence of snapshots to a streaming table as SCD Type 1 or Type 2, handling out-of-order events for you.
prerequisites: [pipelines-overview, change-data-feed]
related: [merge-upsert, pipelines-expectations, medallion-architecture, lakeflow-connect, gold-layer-objects]
exams:
  - cert: de-professional
    domain: "Developing Code for Data Processing using Python and SQL"
    objective: "Use AUTO CDC APIs (formerly APPLY CHANGES) to simplify CDC in Lakeflow Spark Declarative Pipelines."
sources:
  - url: https://docs.databricks.com/aws/en/ldp/cdc
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/ldp/developer/ldp-sql-ref-apply-changes-into
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/data-engineering/what-is-cdc
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/ldp/developer/ldp-python-ref-apply-changes
    checked: 2026-09-11
aliases: [apply changes, apply changes into, auto cdc, auto cdc from snapshot, scd type 2, __START_AT, __END_AT, create_auto_cdc_flow, bitemporal]
updated: 2026-09-11
status: published
maturity: ga
---

## What it is

**AUTO CDC** is the API in Lakeflow pipelines (see [[pipelines-overview]]) that takes a stream of change records and keeps a target streaming table in sync with them, as either **SCD Type 1** (current state only) or **SCD Type 2** (full history). You declare the target table, the key columns, and the column that orders the events; the pipeline works out the inserts, updates and deletes, including what to do when events arrive out of order.

**AUTO CDC FROM SNAPSHOT** solves the same problem when the source emits no change feed at all, only periodic full dumps. It compares each snapshot with the previous one, derives the change feed itself, and then applies it the same way.

> [!changed]
> The docs are explicit that the **AUTO CDC APIs replace the APPLY CHANGES APIs and have the same syntax**. `APPLY CHANGES INTO`, `apply_changes()` and `apply_changes_from_snapshot()` still work, and exam guides written before mid-2025 use those names, but the recommended spelling is now `AUTO CDC ... INTO`, `create_auto_cdc_flow()` and `create_auto_cdc_from_snapshot_flow()`.

## Why it exists

Applying a change feed by hand means a `MERGE` per micro-batch, which means a staging table, a window function to pick the last change per key, and a set of assumptions about ordering that nobody writes down. See [[merge-upsert]] for what that looks like when you do it yourself. It works, and it is the right tool for a one-off, but as a pattern it is copied from pipeline to pipeline and gets subtly wrong every time: a late-arriving update overwrites a newer value, a delete is applied before the insert it supersedes, a full refresh reprocesses history in a different order and lands somewhere else.

SCD Type 2 is worse. Closing the previous version of a row, opening a new one, and keeping the validity intervals consistent when an event turns up two hours late is genuinely difficult logic, and it is the same logic in every warehouse in the world. AUTO CDC makes it a declaration: keys, sequencing column, SCD type.

## How it works

### Requirements

The CDC APIs need the pipeline to run on serverless compute, or on the Pro or Advanced editions of Lakeflow pipelines. They are not part of open-source Apache Spark Declarative Pipelines.

### Declaring a flow

You create the target streaming table first, then a flow that writes into it:

```sql
CREATE OR REFRESH STREAMING TABLE users_current;

CREATE FLOW apply_cdc AS AUTO CDC INTO users_current
FROM stream(main.bronze.users_cdf)
KEYS (user_id)
APPLY AS DELETE WHEN operation = "DELETE"
SEQUENCE BY sequence_num
COLUMNS * EXCEPT (operation, sequence_num)
STORED AS SCD TYPE 1;
```

```python
from pyspark import pipelines as dp
from pyspark.sql.functions import col, expr

dp.create_streaming_table("users_current")

dp.create_auto_cdc_flow(
    target="users_current",
    source="users",
    keys=["user_id"],
    sequence_by=col("sequence_num"),
    apply_as_deletes=expr("operation = 'DELETE'"),
    except_column_list=["operation", "sequence_num"],
    stored_as_scd_type=1,
)
```

The default behaviour for `INSERT` and `UPDATE` events is an upsert on the keys. `STORED AS` defaults to SCD Type 1 if you leave it out.

### The clauses that matter

| Clause | Python argument | What it does |
| --- | --- | --- |
| `KEYS` | `keys` | the columns that identify a row; required |
| `SEQUENCE BY` | `sequence_by` | the column that orders events; required, must be sortable, no nulls |
| `APPLY AS DELETE WHEN` | `apply_as_deletes` | which records mean "this row is gone" |
| `APPLY AS TRUNCATE WHEN` | `apply_as_truncates` | which records clear the whole table; **SCD Type 1 only** |
| `COLUMNS ... EXCEPT` | `except_column_list` | which source columns to keep out of the target |
| `STORED AS` | `stored_as_scd_type` | `SCD TYPE 1`, `SCD TYPE 2`, or `BITEMPORAL` |
| `TRACK HISTORY ON` | `track_history_except_column_list` | which columns generate a new version in SCD Type 2 |
| `IGNORE NULL UPDATES` | `ignore_null_updates` | a null in the change record leaves the target value alone, for partial updates |
| `ONCE` | `once` | a one-time backfill flow, not re-run on refresh except a full refresh |

### Sequencing and out-of-order events

`SEQUENCE BY` is the whole trick. AUTO CDC processes events in the order that column defines, not the order they arrive, so an update stamped `5` that turns up after an update stamped `6` is discarded rather than applied on top. The column must be a sortable type, must be monotonically increasing in the sense that matters (one distinct update per key per value), and nulls are not supported. To break ties on a timestamp, sequence by a `STRUCT` of two columns: `SEQUENCE BY STRUCT(event_ts, event_id)` orders by the first field and falls back to the second.

For SCD Type 2 sources, a deleted row is kept briefly as a tombstone in the underlying Delta table so that a late event for that key can still be ordered correctly, with a view in the metastore filtering the tombstones out. The retention window is the `pipelines.cdc.tombstoneGCThresholdInSeconds` table property.

### `__START_AT` and `__END_AT`

An SCD Type 2 target gains two generated columns holding the validity interval of each version, taken from the values of the sequencing column rather than from wall-clock time. A row whose `__END_AT` is `NULL` is the current version. If you declare the target table's schema explicitly, you must include both columns with the same type as the sequencing column.

By default any change to any column opens a new version. `TRACK HISTORY ON * EXCEPT (city)` narrows that: changes to `city` update the current row in place, changes to anything else create a version.

### AUTO CDC FROM SNAPSHOT

Available in the Python interface only. Instead of a change feed you give it a snapshot, and it diffs consecutive snapshots to derive inserts, updates and deletes. Two patterns:

- **one snapshot per pipeline run**, versioned by the run itself, when snapshots arrive regularly and in order;
- **a version function**, which you write to return the next `(DataFrame, version)` pair, when several snapshots are waiting or ordering needs to be explicit. Snapshots are processed in ascending version order; one that turns up out of order is skipped, and returning `None` means there is nothing new.

Snapshots can come from a Delta table, from files in cloud storage, or over JDBC.

### Bitemporal tracking

`STORED AS BITEMPORAL` with `SYSTEM SEQUENCE BY` extends SCD Type 2 across two time dimensions: business time and system time, so you can ask both "what was true then" and "what did we know then". It is in **Beta**, so treat it as something to be aware of rather than something to design around.

## Example: SCD Type 2 with history on a subset of columns

```sql
CREATE OR REFRESH STREAMING TABLE main.silver.customers_history;

CREATE FLOW customers_cdc AS AUTO CDC INTO main.silver.customers_history
FROM stream(main.bronze.customers_cdf)
KEYS (customer_id)
APPLY AS DELETE WHEN operation = "DELETE"
SEQUENCE BY STRUCT(op_ts, op_id)
COLUMNS * EXCEPT (operation, op_ts, op_id)
STORED AS SCD TYPE 2
TRACK HISTORY ON * EXCEPT (last_seen_at);
```

```python
from pyspark import pipelines as dp
from pyspark.sql.functions import col, expr, struct

@dp.view
def customers():
    return spark.readStream.table("main.bronze.customers_cdf")

dp.create_streaming_table("main.silver.customers_history")

dp.create_auto_cdc_flow(
    target="main.silver.customers_history",
    source="customers",
    keys=["customer_id"],
    sequence_by=struct("op_ts", "op_id"),        # tie-break on op_id
    apply_as_deletes=expr("operation = 'DELETE'"),
    except_column_list=["operation", "op_ts", "op_id"],
    stored_as_scd_type="2",
    track_history_except_column_list=["last_seen_at"],
)
```

A customer who moves twice ends up with three rows: two closed intervals and one with `__END_AT IS NULL`. A change to `last_seen_at` alone updates the current row and creates nothing.

## Common mistakes

- **Sequencing by ingestion time instead of source event time.** Two events that hit the bronze table in the wrong order then get applied in the wrong order. Use the sequence number or commit timestamp the source system emits.
- **A nullable sequencing column.** Nulls are not supported, and the failure is not obvious from the pipeline UI. Enforce it with an expectation, see [[pipelines-expectations]].
- **Expecting `APPLY AS TRUNCATE WHEN` to work on SCD Type 2.** It is supported for Type 1 only, because truncating a history table has no sensible meaning.
- **Streaming from an AUTO CDC target as if it were an ordinary table.** The target is rewritten in place by the flow, so a downstream streaming read has to go through its change data feed, not a plain `STREAM` read.
- **Declaring the target schema for SCD Type 2 and omitting `__START_AT` and `__END_AT`.** They have to be there, with the same data type as the sequencing column.
- **Reaching for AUTO CDC on a source that emits full snapshots.** That is what `AUTO CDC FROM SNAPSHOT` is for, and it is Python-only.

> [!exam]
> The exam guide names this objective with both spellings: "Use AUTO CDC APIs (formerly APPLY CHANGES)". Know that the two are the same API with the same syntax. Be able to pick SCD Type 1 versus Type 2 from a requirement ("we need to know what the address was last March" is Type 2), name `__START_AT` and `__END_AT` and what a `NULL` `__END_AT` means, and explain that `SEQUENCE BY` is what makes out-of-order events safe. Know that `AUTO CDC FROM SNAPSHOT` is the answer when the source has no change feed, and that it exists only in Python.
