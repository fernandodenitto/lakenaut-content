---
id: abac-policies
title: ABAC policies in Unity Catalog
area: catalog
level: advanced
summary: ABAC policies apply row filters and column masks at the catalog or schema level based on governed tags. A rule written once with CREATE POLICY covers every tagged table, present and future.
prerequisites: [row-filters-column-masks, privileges-grant-revoke]
related: [unity-catalog-overview, managed-vs-external-tables, medallion-architecture]
exams:
  - cert: de-associate
    domain: "Governance and Security"
    objective: "Understand Unity Catalog ABAC policies to centrally control row-level filtering and column masking for sensitive data."
sources:
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/abac/
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/abac/policies
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/abac/abac-vs-rls-cm
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/abac/requirements
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-ddl-create-policy
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/admin/governed-tags
    checked: 2026-09-09
aliases: [abac, attribute-based access control, governed tags, create policy, policy]
updated: 2026-09-11
status: published
---

## What it is

**ABAC** (attribute-based access control) is how Unity Catalog applies access rules based on the **attributes** of objects rather than their names. The attribute is a **governed tag** (`pii = email`, `sensitivity = high`); the rule is a **policy** attached to a catalog, a schema, or a table that says: "for members of these groups, on columns with this tag, apply this mask" or "on every table with this tag, apply this row filter."

## Why it exists

Per-table [[row-filters-column-masks|row filters and column masks]] scale poorly: a hundred tables with an email column means a hundred `ALTER TABLE` statements, and the hundred-and-first table created tomorrow is born unprotected. With ABAC the rule is written once by the catalog owner, and every table that receives the tag inherits it automatically, with no way for the table owner to remove it.

## How it works

### Governed tags

Regular tags are free-form labels. **Governed tags** are defined at the account level (by an account admin or metastore admin) with a list of allowed values and permissions on who may assign them. In the UI they show a padlock. Only governed tags can be used in policy conditions. There are also predefined system tags (for example `system.certification_status` and the `class.*` family) that cannot be modified.

There are two condition functions:

- `has_tag('name')`: the object or column has the tag, with any value;
- `has_tag_value('name', 'value')`: the tag has exactly that value.

### Anatomy of a policy

```sql
CREATE [ OR REPLACE ] POLICY policy_name
ON { CATALOG c | SCHEMA c.s | TABLE c.s.t }
[ COMMENT '...' ]
{ ROW FILTER function | COLUMN MASK function }
TO principal [, ...]
[ EXCEPT principal [, ...] ]
FOR TABLES
[ WHEN condition ]                                   -- on the object
[ MATCH COLUMNS condition AS alias [, ...] ]         -- on the columns
[ ON COLUMN alias ]                                  -- column mask only
[ USING COLUMNS ( alias | constant [, ...] ) ]
```

| Clause | Meaning |
| --- | --- |
| `ON` | where the policy is attached: it applies to everything below |
| `TO` / `EXCEPT` | who it applies to and who is exempt (often `account users` with `EXCEPT` for admins) |
| `FOR TABLES` | the target object type (tables, materialized views, streaming tables) |
| `WHEN` | condition on the object, for example `has_tag_value('sensitivity', 'high')` |
| `MATCH COLUMNS ... AS alias` | selects columns by tag and gives them a name usable later |
| `ON COLUMN` | which column to mask |
| `USING COLUMNS` | additional arguments to the function |

The function is a SQL UDF, the same kind used by per-table filters; whoever queries the table needs `EXECUTE` on it. Creating or modifying a policy requires `MANAGE` on the `ON` object, or ownership.

### Column mask

```sql
CREATE FUNCTION prod.sec.ultime_cifre(valore STRING, n INT)
RETURN IF(is_account_group_member('hr'), valore, CONCAT('***', RIGHT(valore, n)));

CREATE POLICY mask_tax_id
ON CATALOG prod
COMMENT 'Tax ID visible in full only to HR'
COLUMN MASK prod.sec.ultime_cifre
TO `account users` EXCEPT `hr`
FOR TABLES
MATCH COLUMNS has_tag_value('pii', 'codice_fiscale') AS cf
ON COLUMN cf
USING COLUMNS (4);
```

From this point on, every column in `prod` tagged `pii = codice_fiscale` shows only its last four characters to anyone outside `hr`.

### Row filter

```sql
CREATE FUNCTION prod.sec.solo_it(region STRING)
RETURN region = 'IT';

CREATE POLICY filter_non_domestic
ON SCHEMA prod.sales
ROW FILTER prod.sec.solo_it
TO `analysts`
FOR TABLES
WHEN has_tag_value('sensitivity', 'high')
MATCH COLUMNS has_tag('geo_region') AS region
USING COLUMNS (region);
```

From Python you run it with `spark.sql(...)`, like any DDL.

### Evaluation and conflicts

Policies are evaluated on every query: if the object carries the required tags, the policy applies. At runtime only **one** row filter and **one** mask per column can resolve for a given user: if two policies (or a policy and a per-table filter) apply the same function, the query proceeds; if they apply different functions, the query fails with an error. The comparison is on the functions, not on their results.

### ABAC versus per-table filters

| | Per-table row filter / mask | ABAC policy |
| --- | --- | --- |
| Scope | one table | catalog, schema, or table and everything below it |
| Selection | by name | by governed tag |
| Who manages it | table owner | catalog/schema owner; the table owner cannot remove it |
| New tables | must be configured by hand | covered as soon as they are tagged |
| OpenSharing (Delta Sharing) | no | yes, if the share owner is exempt |
| When to use | table-specific logic, a few stable tables | cross-cutting rules, a growing data estate |

### Requirements and limits

- Compute: serverless, or Databricks Runtime 16.4 or later (Standard; Dedicated with fine-grained filtering). Older runtimes cannot read protected tables: use `EXCEPT` to exempt the principals that need them.
- Policies do not apply to views; a view over a protected table is evaluated with the identity of whoever queries it.
- Materialized views and streaming tables: the refresh runs with the identity of the pipeline owner; if the owner is subject to the policy, the data is materialized already masked. Exempt them.
- Time travel and clone fail on protected tables.
- Quotas: 100 policies per catalog or schema, 50 per table, 20 principals per policy, 3 conditions in `MATCH COLUMNS`.
- There are also **GRANT** policies (granting privileges based on tags) and **DENY** policies (beta, denying `MANAGE ACCESS CONTROL`): not needed for the Associate exam, but they explain why `DENY` is not a statement in Unity Catalog (see [[privileges-grant-revoke]]).

## Example

A data steward tags `prod.crm.customers.email` with `pii = email` and `prod.marketing.lead.email` with the same tag. A single policy on `prod` covers both, plus every future table:

```sql
CREATE FUNCTION prod.sec.mask_email(email STRING)
RETURN CONCAT('***@', SPLIT_PART(email, '@', 2));

CREATE POLICY mask_email
ON CATALOG prod
COLUMN MASK prod.sec.mask_email
TO `account users` EXCEPT `privacy-office`
FOR TABLES
MATCH COLUMNS has_tag_value('pii', 'email') AS e
ON COLUMN e;
```

## Common mistakes

- Using a regular tag in the condition: only governed tags work.
- Forgetting `EXCEPT` for the pipeline owner: the materialized views end up masked for everyone.
- Attaching a policy and a `SET MASK` with different functions to the same column: the querying user gets an error, not double masking.
- Assuming the table owner can remove the policy: only whoever created it at the higher level can.

> [!exam]
> Expect questions like "how do you apply the same mask to every column with sensitive data in a catalog, including future ones?" (ABAC policy with governed tags and `MATCH COLUMNS`), "how is it different from a per-table row filter?" (scope, selection by tag, central management the table owner cannot override), and "what do you need to define a policy?" (governed tags on the objects, a SQL UDF, `MANAGE` on the catalog or schema). Remember the names: **governed tag**, `CREATE POLICY`, `has_tag` / `has_tag_value`, `TO ... EXCEPT`.
