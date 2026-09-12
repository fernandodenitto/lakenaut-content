---
id: predictive-optimization
title: Predictive optimization
area: delta-lake
level: intermediate
summary: Predictive optimization decides on its own when to run OPTIMIZE, VACUUM and ANALYZE on Unity Catalog managed tables, on serverless compute, with no maintenance job to schedule.
prerequisites: [delta-lake-overview, managed-vs-external-tables]
related:
  [
    liquid-clustering,
    delta-optimize-vacuum,
    managed-vs-external-tables,
    system-tables,
    data-layout-partitioning-zorder,
  ]
exams:
  - cert: de-associate
    domain: "Troubleshooting, Monitoring, and Optimization"
    objective: "Liquid Clustering and predictive optimization."
  - cert: de-professional
    domain: "Cost & Performance Optimization"
    objective: "Understand how Unity Catalog managed tables reduce operational overhead and maintenance burden."
sources:
  - url: https://docs.databricks.com/aws/en/optimizations/predictive-optimization
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/admin/system-tables/predictive-optimization
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/delta/data-skipping
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/tables/tune-file-size
    checked: 2026-09-12
aliases:
  [
    predictive optimization,
    ENABLE PREDICTIVE OPTIMIZATION,
    automatic statistics,
    automatic liquid clustering,
    predictive_optimization_operations_history,
  ]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

**Predictive optimization** is a managed service that runs three maintenance commands on Unity Catalog managed tables without being asked: `OPTIMIZE`, `VACUUM`, and `ANALYZE`. It looks at how each table is written and queried, decides which tables would benefit from which operation, queues the work, and runs it on serverless compute for jobs. There is no job to create, no cluster to size, and no schedule to tune. The bill arrives under the serverless jobs SKU.

It covers Delta Lake and Apache Iceberg managed tables, and nothing else. It also collects file-skipping statistics whenever data is written to a managed table, which is a separate habit from the queued `ANALYZE` runs.

## Why it exists

Say it plainly: **predictive optimization contradicts the advice every Databricks tutorial used to end with.** "Schedule a nightly `OPTIMIZE` and a weekly `VACUUM`" was correct for years, and on a Unity Catalog managed table it is now the wrong answer. A cron job optimises whether or not the table changed, pays for compaction that buys nothing, and competes with production for the same window. In practice somebody also eventually adds a table and forgets to add it to the list.

Predictive optimization inverts the decision. Rather than you guessing a cadence per table, the service evaluates each table and runs an operation when it judges the benefit worth the compute. The old advice survives in exactly one place, and it is worth knowing where: external tables, where none of this happens.

## How it works

### The three operations

| Operation  | What it does on a managed table                                                                                                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPTIMIZE` | Compacts files toward the autotuned target size, and triggers **incremental clustering** on tables with clustering keys. It never applies `ZORDER`, and on Z-ordered tables it leaves the Z-ordered files alone. |
| `VACUUM`   | Deletes data files no version inside the retention window still needs. On tables with Iceberg reads enabled it also cleans up Iceberg metadata for older versions.                                               |
| `ANALYZE`  | Scans the table and collects statistics for the query optimiser. `ANALYZE TABLE ... DROP STATISTICS` removes what it collected.                                                                                  |

The statistics part is the piece most people miss. On a Unity Catalog **external** table, file-skipping statistics cover the first 32 columns of the schema. On a managed table with predictive optimization, they cover the columns your queries actually filter on, with no 32-column limit. That is a difference between table types, not a tuning knob (see [[data-layout-partitioning-zorder]] for the properties behind the old behaviour).

With **automatic liquid clustering**, the service may also choose or revise clustering keys before it clusters, which is what `CLUSTER BY AUTO` delegates to it. See [[liquid-clustering]] for the key mechanics.

### The retention trap to close before you enable it

`VACUUM` obeys `delta.deletedFileRetentionDuration`, which defaults to 7 days. If your recovery process assumes a month of time travel, raise the property **before** enabling predictive optimization, not after you have discovered what it cleaned up:

```sql
ALTER TABLE main.silver.orders
  SET TBLPROPERTIES ('delta.deletedFileRetentionDuration' = '30 days');
```

Set it below 7 days and predictive optimization still keeps data files for a minimum of 7 days when it runs `VACUUM FULL`, as a floor against data loss.

### Enabling it, and the inheritance model

Predictive optimization has been on by default for accounts created on or after **11 November 2024**. Older accounts were brought in through a gradual rollout that was scheduled to complete by **August 2026**, so most existing accounts are now enabled whether or not anybody chose it. Check rather than assume.

An account admin sets the account default in the account console under Settings, Feature enablement. Catalogs and schemas inherit it, and tables inherit from their schema. Anything below can override:

```sql
ALTER CATALOG main ENABLE PREDICTIVE OPTIMIZATION;
ALTER SCHEMA main.silver DISABLE PREDICTIVE OPTIMIZATION;
ALTER TABLE main.silver.orders INHERIT PREDICTIVE OPTIMIZATION;
```

Two asymmetries matter. Disabling at the account level does **not** disable catalogs or schemas that explicitly enabled it, and an explicit `DISABLE` below sticks even if the account is enabled later. Changing the setting needs account admin at the account level, and ownership or `MANAGE` on the object below it.

### Seeing what it did, and what it declined to do

`DESCRIBE (CATALOG | SCHEMA | TABLE) EXTENDED <name>` shows a **Predictive Optimization** field, and says when the value is inherited from a parent.

On Databricks Runtime 18 LTS and above you can also ask why an operation was skipped. `DESCRIBE TABLE EXTENDED <name> AS JSON` returns a `predictive_optimization_evaluations` field with the most recent result per operation type: `COMPACTION`, `CLUSTERING`, `AUTO_CLUSTERING_COLUMN_SELECTION`, and `VACUUM`. Only the latest evaluation is kept, results take up to 24 hours to appear, and `ANALYZE` has no skip reasons. Catalog Explorer shows the same thing on the **History** tab, where `Auto` means an automatic operation ran and `Not applied` means one was evaluated and skipped.

Across tables there is a system table, `system.storage.predictive_optimization_operations_history` (in Public Preview as of September 2026), carrying `operation_type`, `operation_status`, `operation_metrics`, and the estimated spend in `usage_quantity`. Its `usage_unit` is `ESTIMATED_DBU` because DBUs are apportioned when several operations share a cluster. Rows land within about two hours, billing figures within 24.

### What it does not cover

- **External tables.** Nothing automatic happens. They still need scheduled `OPTIMIZE` and `VACUUM`, and they still collect statistics on the first 32 columns only.
- **Tables loaded into a workspace as OpenSharing recipients.**
- **`ZORDER`.** It is never applied, and Z-ordered files are ignored rather than reorganised.
- **Auto compaction**, which is a different feature: it runs synchronously on the cluster performing the write, while predictive optimization runs asynchronously on serverless. The two are independent and can be used together (see [[delta-optimize-vacuum]]).

Requirements: a workspace on the Premium plan or above, in a supported region, and SQL warehouses or Databricks Runtime 12.2 LTS and above.

## Example: retiring a maintenance job for one schema

```sql
-- 1. protect the recovery window first
ALTER TABLE main.silver.orders
  SET TBLPROPERTIES ('delta.deletedFileRetentionDuration' = '30 days');

-- 2. hand the whole schema over, but keep one table under manual control
ALTER SCHEMA main.silver ENABLE PREDICTIVE OPTIMIZATION;
ALTER TABLE main.silver.audit_log DISABLE PREDICTIVE OPTIMIZATION;

-- 3. confirm the effective setting
DESCRIBE SCHEMA EXTENDED main.silver;

-- 4. a week later, check what it ran and what it cost
SELECT table_name, operation_type, operation_status,
       sum(usage_quantity) AS estimated_dbus
FROM system.storage.predictive_optimization_operations_history
WHERE catalog_name = 'main' AND schema_name = 'silver'
  AND start_time >= current_date() - INTERVAL 7 DAYS
GROUP BY ALL
ORDER BY estimated_dbus DESC;
```

Only after step 4 shows successful `COMPACTION` and `VACUUM` runs on the tables you care about is it safe to delete the nightly maintenance job.

## Common mistakes

- **Deleting the maintenance job for external tables too.** Predictive optimization never touches them. Keep the schedule for anything that is not a managed table.
- **Enabling it on a table whose time travel window you depend on.** The default 7-day `delta.deletedFileRetentionDuration` is what `VACUUM` will honour. Raise it first.
- **Expecting `ZORDER` to be maintained.** It is never applied, and Z-ordered files are skipped rather than reorganised.
- **Assuming an account-level `DISABLE` turns it off everywhere.** Catalogs and schemas that enabled it explicitly keep running.
- **Concluding it is broken because a table looks unoptimised.** Operations are skipped deliberately, and the reason takes up to 24 hours to appear.
- **Confusing it with auto compaction.** Auto compaction runs on your cluster during the write; predictive optimization runs later on serverless. Seeing one does not mean the other is on.

> [!exam]
> The Associate guide pairs predictive optimization with Liquid Clustering in the troubleshooting domain, and the Professional guide asks why managed tables reduce maintenance burden. Know that it runs exactly **`OPTIMIZE`, `VACUUM`, and `ANALYZE`**, on **Unity Catalog managed tables only**, on serverless compute; that external tables and OpenSharing recipients are excluded; that it never runs `ZORDER`; and the enablement syntax `ALTER { CATALOG | SCHEMA | TABLE } ... { ENABLE | DISABLE | INHERIT } PREDICTIVE OPTIMIZATION` with `DESCRIBE ... EXTENDED` to check the effective value. Typical question: "which maintenance work still needs a scheduled job?" The answer is whatever is not a managed table.
