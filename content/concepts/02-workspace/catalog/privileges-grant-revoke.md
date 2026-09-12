---
id: privileges-grant-revoke
title: "Privileges: GRANT, REVOKE, and DENY"
area: catalog
level: intermediate
summary: Unity Catalog privileges are granted to users, groups and service principals and inherit from the catalog down. USE CATALOG and USE SCHEMA are the entry door.
prerequisites: [unity-catalog-overview, managed-vs-external-tables]
related: [row-filters-column-masks, abac-policies, git-folders]
exams:
  - cert: de-associate
    domain: "Governance and Security"
    objective: "Configure access controls using the UI and SQL by applying GRANT, REVOKE, and DENY privileges to principals (users, groups, and service principals) at appropriate levels of the security hierarchy."
sources:
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/manage-privileges/
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/manage-privileges/privileges
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/sql/language-manual/security-grant
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/sql/language-manual/security-deny
    checked: 2026-09-09
aliases: [grant, revoke, deny, privileges, permissions, ownership, show grants]
updated: 2026-09-09
status: published
---

## What it is

A **privilege** is the right to perform an action on a **securable** (catalog, schema, table, view, volume, function, model, external location, and so on). You assign it to a **principal**: a user, a group, or a service principal. In Unity Catalog the model is easy to remember: everything is denied until there is a `GRANT`, and grants flow down the hierarchy.

## Why it exists

Without a single model, every team manages permissions its own way: ACLs on files, roles on the warehouse, notebooks shared with "anyone who has the link." Unity Catalog puts the permissions in the catalog, so they hold across every compute and every workspace, and makes them readable with a query.

## How it works

### The hierarchy and inheritance

```
Metastore
└── Catalog            USE CATALOG, CREATE SCHEMA, BROWSE…
    └── Schema         USE SCHEMA, CREATE TABLE, CREATE VOLUME, CREATE FUNCTION…
        └── Table/View SELECT, MODIFY…
        └── Volume     READ VOLUME, WRITE VOLUME
        └── Function   EXECUTE
```

A privilege granted at one level applies to every child object, present and future: `GRANT SELECT ON CATALOG prod` gives `SELECT` on every table and view in every schema of `prod`. To reach an object, though, you also need the "pass-through" privileges:

- **USE CATALOG** on the catalog and **USE SCHEMA** on the schema. They grant no data access; without them, `SELECT` on the table is not enough.
- **BROWSE** lets you see metadata and request access without USE.

### The privileges you need to know

| Privilege | Level | What it allows |
| --- | --- | --- |
| `USE CATALOG` / `USE SCHEMA` | catalog / schema | traversing the level |
| `SELECT` | table, view, mv, share | reading |
| `MODIFY` | table | INSERT, UPDATE, DELETE (the three also exist separately) |
| `CREATE SCHEMA` / `CREATE TABLE` / `CREATE VOLUME` / `CREATE FUNCTION` | catalog / schema | creating objects |
| `READ VOLUME` / `WRITE VOLUME` | volume | reading and writing files |
| `READ FILES` / `WRITE FILES` / `CREATE EXTERNAL TABLE` | external location | path access and external table creation |
| `EXECUTE` | function, model | invoking |
| `MANAGE` | any | managing permissions, ownership, renaming, dropping |
| `ALL PRIVILEGES` | any | every applicable privilege, present and future |

`ALL PRIVILEGES` does not include `MANAGE`, `READ METADATA`, `EXTERNAL USE SCHEMA`, or `EXTERNAL USE LOCATION`: having everything on the data does not let you redistribute access.

### Ownership

Every securable has an **owner** (whoever created it, or whoever it was transferred to). The owner holds every privilege and can grant them. `GRANT` can also be run by: the owner of the parent catalog or schema, anyone with `MANAGE` on the object, and the metastore admin. Transfer:

```sql
ALTER TABLE prod.sales.orders OWNER TO `data-eng`;
```

Good practice: make a group the owner, not a person.

### GRANT and REVOKE

```sql
GRANT USE CATALOG ON CATALOG prod TO `analysts`;
GRANT USE SCHEMA ON SCHEMA prod.sales TO `analysts`;
GRANT SELECT ON TABLE prod.sales.orders TO `analysts`;

GRANT SELECT, MODIFY ON SCHEMA prod.sales TO `etl-sp-4f2a`;   -- service principal, by application id
GRANT ALL PRIVILEGES ON SCHEMA prod.sales TO `mario.rossi@acme.com`;

REVOKE MODIFY ON SCHEMA prod.sales FROM `analysts`;
```

```python
spark.sql("GRANT SELECT ON TABLE prod.sales.orders TO `analysts`")
spark.sql("REVOKE SELECT ON TABLE prod.sales.orders FROM `analysts`")
```

In the UI: Catalog Explorer → object → **Permissions** tab → **Grant**, pick the principal and check the privilege boxes. It is the same thing as the SQL.

### SHOW GRANTS

```sql
SHOW GRANTS ON TABLE prod.sales.orders;
SHOW GRANTS `analysts` ON SCHEMA prod.sales;
```

It shows only the **explicit** grants on that object, not those inherited from the parent. Anyone with `MANAGE` sees everything; others see only their own.

### DENY

Unity Catalog **does not have** a `DENY` statement: the model is grant-only, and to remove access you use `REVOKE` at the right level. `DENY` exists in the legacy `hive_metastore`, where it denies a privilege with precedence over any grant, cascades downward, and is undone with `REVOKE`:

```sql
DENY SELECT ON TABLE hive_metastore.default.stipendi TO `stagisti`;
```

In Unity Catalog the modern equivalent is **ABAC policies**: DENY policies (in beta) deny `MANAGE ACCESS CONTROL` on tagged objects, and row filters and column masks restrict the data without touching the grants (see [[abac-policies]] and [[row-filters-column-masks]]).

## Example

An `analysts` group needs to read all of `prod.sales` except `stipendi`. In Unity Catalog you cannot deny: you break the grant down.

```sql
GRANT USE CATALOG ON CATALOG prod TO `analysts`;
GRANT USE SCHEMA ON SCHEMA prod.sales TO `analysts`;
GRANT SELECT ON TABLE prod.sales.orders TO `analysts`;
GRANT SELECT ON TABLE prod.sales.customers TO `analysts`;
-- no grant on prod.sales.stipendi
```

Or move `stipendi` into a `prod.hr` schema and grant `SELECT` on the whole `prod.sales` schema. The hierarchy is the tool you use to express exceptions.

## Common mistakes

- `GRANT SELECT` on the table without `USE CATALOG` and `USE SCHEMA`: the user gets "table not found" or permission denied.
- Expecting `SHOW GRANTS` on the table to show permissions inherited from the schema: it shows only the explicit ones.
- Looking for `DENY` in Unity Catalog: it does not exist, reorganize the grants instead.
- Giving `ALL PRIVILEGES` on the catalog to a broad group "to unblock them": it includes `CREATE` and `MODIFY` on everything.
- Leaving a person as owner who then changes teams: the objects are left with nobody able to administer them until an admin transfers ownership.

> [!exam]
> The exam guide mentions GRANT, REVOKE, and DENY: know that in Unity Catalog you use `GRANT` and `REVOKE`, that `DENY` is legacy `hive_metastore` (precedence over grants, cascading), and that in Unity Catalog denials are achieved through the hierarchy levels or ABAC policies. Typical questions: "the user has SELECT but cannot see the table" (missing `USE CATALOG`/`USE SCHEMA`), "how do you grant read on all future tables in a schema?" (`GRANT SELECT ON SCHEMA`), "who can GRANT?" (owner, `MANAGE`, parent owner, metastore admin), "who can be granted to?" (users, account groups, service principals).
