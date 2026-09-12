---
id: data-classification
title: Data Classification in Unity Catalog
area: catalog
level: intermediate
summary: Data Classification scans table columns for sensitive values, writes system class tags onto the ones that match, and those tags are what an ABAC policy masks on.
prerequisites: [governed-tags, unity-catalog-overview]
related: [governed-tags, abac-policies, row-filters-column-masks, system-tables, privileges-grant-revoke]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-classification
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-classification-tags
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-classification-custom-classifiers
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/admin/system-tables/data-classification
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/admin/system-tables/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/admin/governed-tags/
    checked: 2026-09-12
aliases: [data classification, classification tags, class tags, sensitive data discovery, PII discovery, custom classifiers, auto-tagging]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

**Data Classification** is a Unity Catalog feature that looks inside your tables, works out which columns hold sensitive values, and tags those columns with system governed tags from the `class.` family: `class.email_address`, `class.us_ssn`, `class.phone_number`, `class.date_of_birth` and a long list of national identifiers. Detection combines an agentic system built on a large language model with regular expressions, and works at the **column** level.

Two things make it more than a discovery report. The tags it writes are [[governed-tags|governed tags]], so [[abac-policies|an ABAC policy]] can match on them and mask the columns without anyone naming a table. And scanning is continuous rather than a one-off project: you enable it on a catalog and new tables and columns get classified as they appear.

## Why it exists

Every organisation with more than a handful of schemas has the same gap between what governance believes is in the lakehouse and what is actually in it. Somebody exported a support queue into a silver table and its free-text column contains email addresses. You cannot mask what you have not found, and asking table owners does not find it, because the owner is usually the person who did not notice.

The manual alternative is a discovery notebook run quarterly, whose results go stale the day after they land. Data Classification replaces it with a scan the platform schedules itself, writing into the same tag namespace your access policies already read. The report is not the point; sharing one vocabulary with the enforcement is.

## How it works

### Enabling it

Classification is switched on per catalog, and you need to own the catalog or hold `MANAGE` on it. Enabling a single catalog also lets you choose the **schema scope**: *All selected and future schemas*, the default, which picks up schemas created later and lets you untick individual ones, or *Only selected schemas*, which never expands on its own. Enabling many catalogs at once from the results page does not enrol future catalogs either: a new one has to be enabled deliberately.

The workspace needs serverless compute available, which it is by default in Unity Catalog workspaces, and viewing the results in the UI needs a serverless SQL warehouse.

### Incremental scanning

Enabling a catalog creates a background job that scans its tables incrementally. The engine decides when a table is worth looking at rather than sweeping everything on a timer; in practice a new table or column is typically classified **within 24 hours** of being created. Tables that fail a scan are skipped and retried the following day, and an *Errors* button on the results page lists them.

You can also force a **full scan**, which re-evaluates every table in the enabled schemas. Use it after adding a classifier, and budget for it: it costs roughly what the initial scan did, which is more than the incremental ones.

### Tagging is a second switch

Detection and tagging are deliberately separate. A scan records detections; nothing is tagged until you turn **automatic tagging** on for a given classification, which is how you get to review the detected columns before a policy starts masking production. Tagging is set at two levels:

| Level | Who can set it | Effect |
| --- | --- | --- |
| Metastore | metastore admin with `ASSIGN` on the tag | default for every catalog |
| Catalog | `USE CATALOG` and `APPLY TAG` on the catalog, plus `ASSIGN` on the tag | overrides the metastore setting |

At catalog level the three states are *Default (inherited)*, *Active* and *Inactive*. Turning tagging on does not backfill immediately: existing detections are tagged on the next scan, so allow about 24 hours, after which new classifications are tagged as they are found. Turning it off stops new tags and leaves existing ones in place. Note that only account admins hold `MANAGE` and `ASSIGN` on the `class.` system tags by default, so enabling tagging is a two-person job until those grants are delegated.

### The tags themselves

The `class.` tags are system governed tags: Databricks defines the keys and values, nobody can edit them, and the only thing you control is who may assign them. The published catalogue is split into **global** and **regional** tags and cross-referenced against PII, PCI DSS, GDPR, HIPAA, GLBA, DPDPA and PIPEDA, so the mapping from a tag to the regulation that makes you care about it is already done.

### What it costs

Results are kept in default storage and you are not billed for that storage. The compute is billed, and shows up in [[system-tables|the billing system table]] under `billing_origin_product = 'DATA_CLASSIFICATION'`:

```sql
SELECT usage_date,
       identity_metadata.created_by AS created_by,
       usage_metadata.catalog_id   AS catalog_id,
       SUM(usage_quantity) AS dbus
FROM system.billing.usage
WHERE billing_origin_product = 'DATA_CLASSIFICATION'
  AND usage_date >= DATE_SUB(CURRENT_DATE(), 30)
GROUP BY usage_date, created_by, catalog_id
ORDER BY usage_date DESC;
```

`created_by` splits the cost by whoever triggered a scan and `catalog_id` by catalog, which is how you find out that somebody has been pressing *Trigger full scan* on your largest catalog.

### The results system table

`system.data_classification.results` holds one row per column-level detection across every enabled catalog in the metastore. It is **in Public Preview** as of September 2026, is regional, keeps 13 months of history, and is only readable from serverless compute. By default only the account admin can read it, and that default is deliberate: alongside `class_tag`, `confidence` (`HIGH` or `LOW`), `first_detected_time` and `latest_detected_time`, the table carries a `samples` array with up to five of the actual matching values. Sharing it means sharing metastore-wide sample values.

One hard rule: do not put a table-level row filter or column mask on it with `ALTER TABLE ... SET ROW FILTER` or `ALTER TABLE ... ALTER COLUMN ... SET MASK`. Classification writes to this table, and a table-level filter or mask interferes with those writes and fails the scan. ABAC policies are explicitly safe here, which is a neat illustration of how they differ from [[row-filters-column-masks|per-table filters]].

### The Beta edges

Two pieces are **in Beta** as of September 2026 and should not be load-bearing:

- **Detection exclusions.** Marking a detection wrong removes the tag, stops future scans reapplying it, and feeds back into later accuracy. It is also the documented way to handle a false positive, so in practice you will use it and accept the Beta label.
- **Custom classifiers.** These extend detection to things only your organisation has, such as an internal employee number or a partner account code. You pick a governed tag, describe the data in plain language and point at up to 10 sample columns. Creating one needs metastore admin, `ASSIGN` on the tag, and `SELECT` on the sample columns' tables.

### One limitation to plan around

Views and metric views are not scanned. Classify the underlying tables instead, which is the right place anyway: a mask applied by tag on the base column follows the view.

## Example: from a detection to a mask

Once `class.email_address` is being applied, one policy covers every table in the catalog, including the ones created next month:

```sql
CREATE FUNCTION main.sec.redact_email(value STRING)
RETURN CONCAT('***@', SPLIT_PART(value, '@', 2));

CREATE POLICY mask_contact_details
ON CATALOG main
COMMENT 'Mask anything Data Classification flagged as contact information'
COLUMN MASK main.sec.redact_email
TO `account users` EXCEPT `privacy-office`
FOR TABLES
MATCH COLUMNS has_tag('class.email_address') AS c
ON COLUMN c;
```

One policy can cover several classifications by combining conditions, for example `has_tag('class.name') OR has_tag('class.email_address')`. The *User Access* tab of a reviewed classification generates a prefilled policy for you, and shows how many distinct users read masked and unmasked data of that class in the last seven days.

## Common mistakes

- **Assuming a scan masks anything.** Detection, tagging and policy are three separate steps. Until tagging is on for that classification and a policy matches the tag, the data is as exposed as it was.
- **Enabling tagging and checking the tables five minutes later.** Existing detections are tagged on the next scan, within about 24 hours. Nothing is backfilled on the spot.
- **Sharing `system.data_classification.results` to unblock an analyst.** It carries sample values from every enabled catalog in the metastore. Grant it like the sensitive table it is.
- **Protecting that results table with a per-table column mask.** It breaks the scans. Use an ABAC policy instead.
- **Pressing *Trigger full scan* as a habit.** It costs about as much as the first scan. Save it for after a classifier change.
- **Enabling classification on a catalog of views.** Views and metric views are skipped; the tables underneath them need to be in scope.

> [!tip]
> Leave automatic tagging off for a cycle after you enable a catalog, and review the detections class by class rather than table by table. The `class.` tags are the contract between this feature and your access policies, so a false positive that gets tagged becomes a masked column somebody has to escalate about.
