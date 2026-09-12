---
id: governed-tags
title: Governed tags
area: catalog
level: intermediate
summary: Governed tags are account-level tag keys with a fixed list of allowed values and their own assign permission, which is what makes them safe to write access policies against.
prerequisites: [unity-catalog-overview, privileges-grant-revoke]
related: [abac-policies, data-classification, row-filters-column-masks, system-tables, privileges-grant-revoke]
exams:
  - cert: de-associate
    domain: "Governance and Security"
    objective: "Understand Unity Catalog ABAC policies to centrally control row-level filtering and column masking for sensitive data."
sources:
  - url: https://docs.databricks.com/aws/en/admin/governed-tags/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/admin/governed-tags/manage-governed-tags
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/admin/governed-tags/manage-permissions
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/admin/governed-tags/automate-tag-assignment
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/database-objects/tags
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-ddl-create-governed-tag
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-ddl-set-tag
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/information-schema/column_tags
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/admin/system-tables/governed-tags
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/admin/system-tables/
    checked: 2026-09-12
aliases: [governed tag, tag policy, CREATE GOVERNED TAG, system tags, ASSIGN, APPLY TAG, tag automations, certification status]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

A tag in Unity Catalog is a key with an optional value stuck onto an object. By default tags are **free-form**: anyone with `APPLY TAG` on the object, plus `USE SCHEMA` and `USE CATALOG` above it, can invent the key, invent the value and attach it. That is fine for organising a catalog and useless as the basis for an access rule, because `pii`, `PII` and `Pii` are three different keys and nothing stops a table owner from setting `sensitivity = lowish`.

A **governed tag** is the same key promoted to the **account** level and given a **tag policy**: a fixed list of allowed values (or no list at all, for a key-only tag) plus its own permission deciding who may assign it. Governed tags appear under a *Governed* heading in the tag picker with a lock icon; free-form tags stay under *Other*. Both kinds coexist in the same account and are searched the same way. The difference that matters is that only a governed tag can be matched by [[abac-policies|an ABAC policy]].

## Why it exists

Once you decide to protect data by attribute rather than by name, the attribute becomes part of the security perimeter. An ABAC policy that masks every column tagged `pii = email` is only as good as the discipline behind that tag: a typo means a column silently stops being masked, and a table owner who can edit the tag can edit their way out of the policy, which is not something a per-table [[row-filters-column-masks|mask]] can be talked out of. Governed tags close both holes by moving the vocabulary to the account and the right to use it to a separate grant, so the people who classify data are not necessarily the people who own it.

The same mechanism then pays for itself outside access control: cost centre tags that actually reconcile, a single `system.certification_status` value that data consumers can trust, and a machine-readable signal for [[data-classification]] to write into.

## How it works

### Creating and changing one

Governed tag DDL requires Databricks SQL or Databricks Runtime 18.1 and above, and the `CREATE` permission at account level:

```sql
-- Key only: the tag is either present or absent.
CREATE GOVERNED TAG is_pii;

-- Closed vocabulary.
CREATE GOVERNED TAG sensitivity
  DESCRIPTION 'How widely this asset may circulate'
  VALUES ('public', 'internal', 'confidential', 'restricted');

-- SET VALUES is declarative: this list replaces the old one entirely.
ALTER GOVERNED TAG sensitivity SET VALUES ('public', 'internal', 'confidential', 'restricted', 'secret');

DROP GOVERNED TAG is_pii;
```

Creating a governed tag whose key is already in use as a free-form tag **converts every existing assignment** of that key on the spot. Values outside the new allowed list are not stripped off the objects carrying them, but they cannot be set again. Dropping a governed tag does the reverse: the assignments stay on the objects and go back to being ungoverned, so anyone with `APPLY TAG` can rewrite them.

### The three permissions

| Permission | What it allows | Scope |
| --- | --- | --- |
| `CREATE` | create new governed tags | account only |
| `MANAGE` | edit and delete a tag, and grant `MANAGE`/`ASSIGN` on it | account, or one tag |
| `ASSIGN` | put the tag on an object | account, or one tag |

Account admins hold all three at account level. Workspace admins hold `CREATE` by default, which an account admin can take away with the `disable-governed-tag-create` setting. Whoever creates a tag gets `MANAGE` on it automatically. Changes to these permissions can take 30 seconds or more to propagate even though the UI updates at once.

`ASSIGN` is not a substitute for `APPLY TAG`: to put a governed tag on a table you need `ASSIGN` on the tag **and** `APPLY TAG` on the table, on top of `USE CATALOG` and `USE SCHEMA` (see [[privileges-grant-revoke]]).

### What you can tag, and what you cannot

Governed tags go on Unity Catalog securables: catalogs, schemas, tables, table columns, volumes, views, functions, registered models, model versions, external metadata objects and services. They also go on workspace objects: dashboards, Genie Agents, Databricks apps and notebooks.

They do **not** go on compute. SQL warehouses and jobs have their own, unrelated tagging mechanism for billing attribution, and nothing you define here reaches them. Tagging external metadata objects is in Public Preview as of September 2026, and its SQL support needs Databricks Runtime 18.2 or above.

Assignment itself is ordinary DDL: `SET TAG` and `UNSET TAG` from Databricks Runtime 16.1, or `ALTER <object> ... SET TAGS` from 13.3 LTS.

### Limits worth remembering

| Limit | Value |
| --- | --- |
| Governed tags per account | 1,000 |
| Allowed values per governed tag | 500 |
| Tags on one securable (table or column) | 50 |
| Column tags across a whole table | 1,000 |
| Length of a key or a value | 256 characters |

Keys and values are case-sensitive, accept UTF-8, may not begin or end with whitespace, and may not contain `* . / < > % & ? \ =` or control characters. Tag text is stored as plain text and may be replicated globally, so never put anything sensitive in a key, a value or a description.

### Inheritance, which is narrower than it sounds

Tag a catalog or a schema and everything below it counts as carrying the tag, columns excepted. That inheritance applies **only** when ABAC policies are evaluated. It is not a general property: a query against `information_schema` will not show the parent's tag on the child.

### System governed tags

Databricks ships a set of predefined governed tags, marked with a spanner and hidden behind an *Include system tags* toggle. Their keys and values are fixed and cannot be edited or deleted even with `MANAGE`; all `MANAGE` buys you there is the ability to hand out `ASSIGN`. They use reserved prefixes: `system.` (for example `system.certification_status`, with the values that put a tick or a restricted icon next to an asset in Catalog Explorer), `class.` (written by Data Classification), `sap.PersonalData.` (synced from SAP Business Data Cloud) and `ai.` (properties of the models in `system.ai`, such as `ai.model_creator`).

### The parts that are not GA

Governed tags themselves are generally available. Two things around them are not, as of September 2026:

- **The governed tags system table**, `system.tags.governed_tags`, is in **Beta**. Like the other [[system-tables]] it is regional; it keeps 365 days of history and holds one row per governed tag key including deleted ones, so you filter on `deleted_at IS NULL` for the live list.
- **Tag automations** (*Automate tag assignment*) are in **Beta**, behind a workspace preview toggle. They assign or remove governed tags on tables and volumes from deterministic rules over metadata: owner, description present or absent, read and write query counts over the last 30 days, days since last queried, name substrings, and existing tags on the asset or its columns. Saving one starts a dry run that only records what it would have matched. Read them to know they exist rather than as something to build a control on.

For scanning column **contents** rather than metadata, the tool is [[data-classification]], not an automation.

## Example: a sensitivity tier nobody can misspell

```sql
CREATE GOVERNED TAG sensitivity
  DESCRIPTION 'How widely this asset may circulate'
  VALUES ('public', 'internal', 'confidential', 'restricted');

-- Column-level classification, one statement per column.
ALTER TABLE main.crm.customers ALTER COLUMN email       SET TAGS ('sensitivity' = 'restricted');
ALTER TABLE main.crm.customers ALTER COLUMN loyalty_tier SET TAGS ('sensitivity' = 'internal');

-- Schema-level assignment with the shorter syntax, from Databricks Runtime 16.1.
-- The key and the value are identifiers here, not string literals.
SET TAG ON SCHEMA main.crm sensitivity = confidential;
```

The policy that pays for the tag is written once, over the whole catalog:

```sql
CREATE FUNCTION main.sec.redact(value STRING) RETURN '***';

CREATE POLICY mask_restricted
ON CATALOG main
COLUMN MASK main.sec.redact
TO `account users` EXCEPT `privacy-office`
FOR TABLES
MATCH COLUMNS has_tag_value('sensitivity', 'restricted') AS c
ON COLUMN c;
```

Auditing what exists is a join between the Beta system table and each catalog's information schema:

```sql
SELECT t.tag_key, ct.catalog_name, ct.schema_name, ct.table_name, ct.column_name, ct.tag_value
FROM system.tags.governed_tags AS t
JOIN main.information_schema.column_tags AS ct
  ON ct.tag_name = t.tag_key
WHERE t.deleted_at IS NULL
ORDER BY t.tag_key;
```

## Common mistakes

- **Writing an ABAC policy against a free-form tag.** The condition functions only see governed tags, so the policy matches nothing and the columns stay in the clear.
- **Dropping a governed tag that a policy references.** Every query inside that policy's scope starts failing with `INVALID_PARAMETER_VALUE.UC_ABAC_UNKNOWN_TAG_POLICY`. Update or delete the policy first.
- **Granting `ASSIGN` and expecting people to be able to tag.** They also need `APPLY TAG` on the object. Granting only `APPLY TAG` has the same dead end from the other side.
- **Trying to drop a column that carries a governed tag.** The `DROP COLUMN` fails by design. `UNSET TAG ON COLUMN ...` first, then drop, and remember that time travel can still surface the old data.
- **Expecting one `ALTER TABLE` to tag several columns.** Tags take one statement per column, unlike `COMMENT`.
- **Reaching for governed tags to attribute warehouse or job spend.** Compute uses a separate tagging mechanism that governed tags do not touch.

> [!exam]
> The Data Engineer Associate guide asks about ABAC policies, and governed tags are the half of that objective people skip. Know that a governed tag is defined at the **account** level with a list of allowed values, that the permission to use it is `ASSIGN` (on top of `APPLY TAG` on the object), that only governed tags can appear in `has_tag` and `has_tag_value` conditions, and that the `class.*` tags written by Data Classification are system governed tags, which is why they work in a policy without anyone defining them.
