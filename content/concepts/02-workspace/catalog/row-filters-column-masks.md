---
id: row-filters-column-masks
title: Row filters and column masks
area: catalog
level: advanced
summary: A row filter is a SQL UDF deciding which rows a user sees; a column mask transforms a value. Both attach with ALTER TABLE and tell groups apart with is_account_group_member.
prerequisites: [privileges-grant-revoke, unity-catalog-overview]
related: [abac-policies, managed-vs-external-tables, gold-layer-objects]
exams:
  - cert: de-associate
    domain: "Governance and Security"
    objective: "Understand column-level masking and row-level security to restrict data visibility based on user groups."
sources:
  - url: https://docs.databricks.com/aws/en/tables/row-and-column-filters
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-ddl-row-filter
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-ddl-column-mask
    checked: 2026-09-09
aliases: [row-level security, column masking, row filter, mask, is_account_group_member]
updated: 2026-09-11
status: published
---

## What it is

With `GRANT SELECT` a user sees either the whole table or nothing. **Row filters** and **column masks** add a layer below that: the same table, with the same `SELECT`, returns different rows and values to different users.

- A **row filter** is a SQL UDF that returns `BOOLEAN`; rows for which it returns `FALSE` disappear from the result.
- A **column mask** is a SQL UDF that receives the column value and returns either the original value or a masked version. A column has at most one mask.

Both are applied at the table level and hold for every query, from any compatible compute.

## Why it exists

The historical alternative was **dynamic views**: one view per audience, with `CASE WHEN is_member(...)` in the `SELECT`. It works, but it multiplies objects, and anyone with access to the base table bypasses the view. Filters and masks live on the table itself: one object, one rule.

## How it works

### Identity functions

Inside the UDFs you use functions that read who is querying:

| Function | Returns |
| --- | --- |
| `current_user()` | the current user |
| `is_account_group_member('group')` | `TRUE` if the user is in the **account-level** group |
| `is_member('group')` | same, but for workspace-level groups (legacy) |

In Unity Catalog use `is_account_group_member`.

### Row filter

```sql
CREATE FUNCTION prod.sec.filter_region(region STRING)
RETURN IF(is_account_group_member('direzione'), TRUE, region = 'IT');

ALTER TABLE prod.sales.orders SET ROW FILTER prod.sec.filter_region ON (region);
```

The `ON (...)` clause maps table columns (or constants) to the function parameters. Members of `direzione` see everything; everyone else sees only rows with `region = 'IT'`. It can also be defined at `CREATE TABLE` time:

```sql
CREATE TABLE prod.sales.orders (id BIGINT, region STRING, amount DECIMAL(10,2))
WITH ROW FILTER prod.sec.filter_region ON (region);
```

Removal: `ALTER TABLE prod.sales.orders DROP ROW FILTER;`

### Column mask

```sql
CREATE FUNCTION prod.sec.mask_email(email STRING)
RETURN CASE WHEN is_account_group_member('hr') THEN email
            ELSE CONCAT('***@', SPLIT_PART(email, '@', 2)) END;

ALTER TABLE prod.sales.customers ALTER COLUMN email SET MASK prod.sec.mask_email;
```

A mask can look at **other columns** with `USING COLUMNS`: the function receives the value to mask first, then the additional columns.

```sql
CREATE FUNCTION prod.sec.maschera_per_paese(valore STRING, paese STRING)
RETURN IF(is_account_group_member(CONCAT('hr_', paese)), valore, 'REDACTED');

ALTER TABLE prod.sales.customers
  ALTER COLUMN indirizzo SET MASK prod.sec.maschera_per_paese USING COLUMNS (paese);
```

Removal: `ALTER TABLE prod.sales.customers ALTER COLUMN email DROP MASK;`

From Python it is all `spark.sql(...)`: there is no dedicated DataFrame API.

```python
spark.sql("""
  ALTER TABLE prod.sales.customers
  ALTER COLUMN email SET MASK prod.sec.mask_email
""")
```

### Who can, and from where

You need ownership of the table (or `MANAGE`), and whoever queries needs `EXECUTE` on the function. The compute must be Unity Catalog compatible (serverless, SQL warehouse, a cluster in Standard access mode, or Dedicated with fine-grained filtering enabled).

### Limits

- They do not apply to **views**: for a view you put the logic in the view itself (dynamic view).
- No path-based access to the files of a table with a filter or mask, otherwise the control could be bypassed.
- **Time travel** and **clone** do not work on tables with these controls.
- `MERGE` does not support filters or masks with complex logic (nested subqueries, aggregations, window functions, limit).
- Tables with a table-level filter or mask cannot be shared with OpenSharing (formerly Delta Sharing).
- Watch the types: if the column is `INT` and the parameter is `STRING` there is an implicit cast; with ANSI mode off a failed cast silently becomes `NULL`.
- Performance: keep UDFs simple, SQL rather than Python, few distinct masks, few arguments.

When the same rule must hold across dozens of tables, the right level is not the table but the catalog or schema, with a policy: see [[abac-policies]].

## Example

Table `prod.hr.dipendenti` with `department`, `salary`, `codice_fiscale`. Rule: each manager sees only their own department, and only HR sees the salary in the clear.

```sql
CREATE FUNCTION prod.sec.filter_department(department STRING)
RETURN is_account_group_member('hr') OR is_account_group_member(CONCAT('mgr_', department));

CREATE FUNCTION prod.sec.mask_salary(salary DECIMAL(10,2))
RETURN IF(is_account_group_member('hr'), salary, NULL);

ALTER TABLE prod.hr.dipendenti SET ROW FILTER prod.sec.filter_department ON (department);
ALTER TABLE prod.hr.dipendenti ALTER COLUMN salary SET MASK prod.sec.mask_salary;

GRANT EXECUTE ON FUNCTION prod.sec.filter_department TO `account users`;
GRANT EXECUTE ON FUNCTION prod.sec.mask_salary TO `account users`;
```

A member of `mgr_vendite` running `SELECT * FROM prod.hr.dipendenti` sees only the `sales` rows with `salary` as `NULL`; a member of `hr` sees everything.

## Common mistakes

- Forgetting `GRANT EXECUTE` on the function: the querying user gets an error even with `SELECT`.
- Writing the filter in the function with the logic inverted: `TRUE` means "show."
- Using `is_member` with account groups: use `is_account_group_member`.
- Expecting a mask to apply to a view built on top: the view reads data already masked for the querying user, but you cannot put a mask on the view.
- Applying the same mask by hand to twenty tables: that is the case for ABAC policies.

> [!exam]
> The questions are conceptual: "how do you limit rows by group?" (row filter with a UDF that uses `is_account_group_member`), "how do you hide a value but not the row?" (column mask), "which object do they attach to?" (the table, with `ALTER TABLE ... SET ROW FILTER` / `ALTER COLUMN ... SET MASK`), "how many masks per column?" (one). Remember the limits on views, time travel, and path access, and that for rules spanning many tables the answer is ABAC.
