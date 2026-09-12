---
id: volumes-managed-vs-external
title: Managed and external volumes
area: catalog
subarea: storage
level: intermediate
summary: A managed volume lives in the schema's managed storage and its files are purged after a 7-day window when dropped; an external volume registers a path you own and leaves the files behind.
prerequisites: [unity-catalog-overview, workspace-files-volumes]
related: [workspace-files-volumes, managed-vs-external-tables, external-locations-and-storage-credentials, privileges-grant-revoke, auto-loader]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/volumes/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/volumes/privileges
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/volumes/paths
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-volumes
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-ddl-create-volume
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-ddl-drop-volume
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/volumes/my-files
    checked: 2026-09-12
aliases: [managed volume, external volume, CREATE EXTERNAL VOLUME, READ VOLUME, WRITE VOLUME, volume retention, My Files]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

A **volume** is a Unity Catalog object that governs files. It sits under a schema alongside tables, views and functions, so its full name is `catalog.schema.volume`, and it is the third level of the namespace even though you address its contents by path rather than by name. [[workspace-files-volumes]] covers where volumes sit among the other file surfaces on the platform; this page is about the two kinds of volume and what the choice commits you to.

- A **managed volume** takes no location. Unity Catalog creates a randomly named directory for it inside the managed storage location of the containing schema, and that directory is the only way in.
- An **external volume** is registered against a directory inside an existing Unity Catalog external location, so you name the path yourself and the files remain addressable by their cloud URI.

The distinction is the same one as [[managed-vs-external-tables]], applied to files: who owns the lifecycle of the bytes.

## Why it exists

Before volumes, files that a team needed to share had nowhere governed to live. DBFS mounts had workspace-wide access at best and no catalog-level grants at all, so "who can read this folder of invoices" was answered by a cloud IAM policy nobody on the data team could see. Volumes put files under the same grant hierarchy as tables, which means the answer is `SHOW GRANTS` and the audit trail is the same one you already read.

Two kinds exist because two different promises are being made. A managed volume promises that Databricks is the only writer and the only reader, and in exchange you never touch a storage credential, a bucket path or a lifecycle rule. An external volume promises nothing of the sort: it adds Unity Catalog governance over a path that other systems already write to, and accepts that those systems keep their direct access.

## How it works

### Where the bytes live, and what happens when you drop the volume

| | Managed volume | External volume |
| --- | --- | --- |
| Location | a generated directory inside the schema's managed storage | a directory you name inside an external location |
| Created with | `CREATE VOLUME` | `CREATE EXTERNAL VOLUME ... LOCATION` |
| Reachable by cloud URI | no | yes |
| On `DROP VOLUME` | files retained 7 days, then purged within 48 hours | metadata removed, files untouched |
| External systems | only through Unity Catalog | direct access is possible and not governed by Unity Catalog |

The 7-day window on a managed volume is the part people misread. It governs **file cleanup and storage billing**, not recovery: you are still paying for those bytes for a week, and the volume itself is gone the moment the statement commits. A dropped volume cannot be brought back. If that is not acceptable, the answer is a backup, not a hope.

For an external volume the files stay exactly where they were, which is convenient and is also why dropping one does not release a single byte of storage cost.

### Governing the part Unity Catalog cannot see

Unity Catalog does not govern reads and writes that an outside system performs directly against the bucket. For an external volume you therefore need a second layer, and there are two supported shapes:

- **Credential vending**: the external engine asks Unity Catalog for a short-lived credential, which carries the requesting principal's Unity Catalog privileges. Unity Catalog stays the source of truth.
- **Cloud-native controls**: IAM and bucket policies on the underlying path, kept deliberately aligned with the grants on the volume.

If neither is in place, the grants on the volume describe what Databricks users can do and nothing more.

### Privileges

| Operation | Needs |
| --- | --- |
| Read or list files | `USE CATALOG`, `USE SCHEMA`, `READ VOLUME` |
| Create, update or delete files | the above plus `WRITE VOLUME` |
| Create a managed volume | `USE CATALOG`, `USE SCHEMA`, `CREATE VOLUME` on the schema |
| Create an external volume | the above plus `CREATE EXTERNAL VOLUME` on the external location |
| Drop the volume, change its owner, manage its grants | ownership or `MANAGE` |
| Rename the volume | ownership or `MANAGE`, plus `CREATE VOLUME` on the schema |

`READ VOLUME` and `WRITE VOLUME` can be granted on the catalog or the schema and cascade downwards like any other [[privileges-grant-revoke|privilege]], which is the usual way to give a team a whole layer at once. The extra privilege on the external location is the hinge of the whole model: it is why a data engineer cannot quietly register a volume over a bucket that governance has not blessed (see [[external-locations-and-storage-credentials]]).

### Paths must not overlap

Unity Catalog refuses to let managed directories overlap, and the rules are worth memorising because the error messages arrive at the worst moment: a volume cannot be defined inside another volume, a table cannot be defined on files inside a volume, a volume cannot be defined inside a table's directory, and an external volume cannot be defined inside a managed storage location. Databricks recommends creating external volumes in subdirectories of an external location rather than at its root, so that later objects still have somewhere to go.

### When a volume, and when a table

You cannot register files that live in a volume as a table. Volumes are path-based access only, so the decision is not about the data's shape but about how you intend to read it. A volume is the right answer for a landing zone that [[auto-loader]] or `COPY INTO` reads from, for wheels and JARs, for checkpoints and logs, for model artefacts, and for images, audio and PDFs. A table is the right answer for anything you want to query by name, with statistics, optimisation and column-level grants.

### Runtime requirements and the awkward limits

Volumes need a SQL warehouse or Databricks Runtime 13.3 LTS or above. On 12.2 LTS and below, operations against a `/Volumes` path can appear to succeed while writing to the compute's ephemeral local disk, which is the nastiest failure mode in this whole area. Beyond that: `dbutils.fs` commands are not distributed to executors, Unity Catalog UDFs cannot read volume paths, RDDs cannot, the legacy `spark-submit` task cannot load a JAR from a volume (use the JAR task), `%sh mv` does not move files between volumes, and you cannot list `/Volumes/<catalog>` or `/Volumes/<catalog>/<schema>` without naming a volume.

Two adjacent features are in **Beta** as of September 2026 and should be read as such: **My Files**, a per-user volume at `/Volumes/Databricks/home/<workspace>/<user>/my_files/`, and the **FILE type**, which lets a table column reference a file stored in a volume.

## Example: a managed staging area and a governed vendor drop

```sql
-- Managed: Databricks owns the storage, nobody outside reads it.
CREATE VOLUME main.landing.staging
  COMMENT 'Working area for ingestion jobs; safe to lose';

-- External: the vendor's SFTP process already writes here.
CREATE EXTERNAL VOLUME main.landing.vendor_a
  LOCATION 's3://acme-data-exchange/vendor-a/incoming'
  COMMENT 'Vendor A daily drop, read-only for us';

GRANT READ VOLUME ON VOLUME main.landing.vendor_a TO `data-engineering`;
GRANT READ VOLUME, WRITE VOLUME ON VOLUME main.landing.staging TO `data-engineering`;

DESCRIBE VOLUME main.landing.vendor_a;
```

The path is identical in both cases, which is the point:

```python
checkpoint = "/Volumes/main/landing/staging/_checkpoints/vendor_a"

(spark.readStream.format("cloudFiles")
  .option("cloudFiles.format", "csv")
  .option("cloudFiles.schemaLocation", checkpoint)
  .load("/Volumes/main/landing/vendor_a/")      # external volume, read only
  .writeStream
  .option("checkpointLocation", checkpoint)      # managed volume, disposable
  .trigger(availableNow=True)
  .toTable("main.bronze.vendor_a_orders"))
```

## Common mistakes

- **Reading the 7-day window as an undo button.** It is a billing and cleanup window. `DROP VOLUME` is not recoverable, and `IF EXISTS` will not save you from dropping the wrong one.
- **Dropping an external volume to free up storage.** Only the metadata goes. The bucket keeps charging until somebody deletes the files or a lifecycle rule does.
- **Putting a managed volume's path in a cloud lifecycle rule or letting another service write to it.** Managed storage is meant to be reached only through Unity Catalog; anything else compromises the access control and the audit trail.
- **Expecting the grants on a volume to constrain the vendor's own tooling.** For an external volume, direct bucket access bypasses Unity Catalog entirely unless you add credential vending or cloud-native controls.
- **Creating an external volume at the root of an external location.** It blocks every later table or volume under that prefix, because paths cannot overlap.
- **Writing new pipelines against a 12.2 LTS cluster and a `/Volumes` path.** The write appears to work and the data lands on ephemeral local disk.

> [!tip]
> Default to managed volumes, and reach for an external volume only when a system outside Databricks has to read or write the same bytes. When you do, write down which of the two governance layers you are relying on for that outside access, because "the volume has grants on it" is not an answer that survives an audit.
