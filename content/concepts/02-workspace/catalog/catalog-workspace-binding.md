---
id: catalog-workspace-binding
title: Workspace-catalog binding
area: catalog
level: intermediate
summary: Every catalog in a metastore is reachable from every attached workspace until you bind it. Binding restricts a catalog to named workspaces, optionally read-only, and overrides individual grants.
prerequisites: [uc-metastore-and-setup, privileges-grant-revoke]
related: [information-schema, uc-metastore-and-setup, external-locations-and-storage-credentials, unity-catalog-overview, privileges-grant-revoke, bundles-variables-targets]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/access-control/workspace-catalog-binding
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/catalogs/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/best-practices
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/connect/unity-catalog/cloud-storage/manage-external-locations
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/connect/unity-catalog/cloud-storage/manage-storage-credentials
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-ddl-alter-catalog
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/information-schema/catalogs
    checked: 2026-09-12
aliases: [workspace binding, catalog binding, isolation mode, ISOLATED, read-only binding, catalog isolation, workspace-bindings]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

A catalog does not belong to a workspace. It belongs to the metastore, and by default every workspace attached to that metastore can see it and query it (see [[uc-metastore-and-setup]]). **Workspace-catalog binding** overrides that default: you switch the catalog's isolation mode to `ISOLATED` and list the workspaces allowed to reach it. From any other workspace, access is denied.

The important word is *denied*. A binding is not a convenience filter on top of the grants; it sits in front of them. A user holding `SELECT` on a table in `prod` who opens the development workspace gets an error, not a row. That is what makes it usable as a control rather than as tidying.

Each binding also carries an access level, so a workspace can be allowed in **read-only**, with every write from that workspace to that catalog blocked.

## Why it exists

The design of Unity Catalog deliberately separates the two trees: workspaces are where people and compute live, catalogs are where data lives, and joining them at the metastore is what lets one grant apply everywhere. That is the right default and it is exactly wrong for a class of requirements that turn up in every regulated organisation: production data must not be reachable from a development environment, two data domains must not be joinable by anyone, sensitive data must only be processed on compute that has been reviewed.

You could try to express those with grants alone, but [[privileges-grant-revoke|grants]] are per principal and per object, and the guarantee you need is per environment. Binding gives you the environment-shaped statement: this catalog exists in these workspaces and nowhere else, whatever anybody has been granted.

Catalogs are already the primary unit of data isolation in [[unity-catalog-overview|Unity Catalog]], usually mirroring an environment, a business unit or both, and each with its own managed storage location. Binding is what you add when the data's isolation boundary and the processing environment's isolation boundary are meant to be the same boundary.

## How it works

### Isolation mode and binding type

Two steps, in this order, because the second is meaningless while the catalog is still open:

```bash
# 1. Stop the catalog being visible to every workspace on the metastore.
databricks catalogs update prod --isolation-mode ISOLATED --profile prod-admin

# 2. List the workspaces that may reach it, and at what access level.
databricks workspace-bindings update-bindings catalog prod \
  --json '{
    "add": [
      {"workspace_id": 1111111111111111, "binding_type": "BINDING_TYPE_READ_WRITE"},
      {"workspace_id": 2222222222222222, "binding_type": "BINDING_TYPE_READ_ONLY"}
    ]
  }' --profile prod-admin

databricks workspace-bindings get-bindings catalog prod --profile prod-admin
```

The default isolation mode is `OPEN`, meaning every workspace attached to the metastore. `BINDING_TYPE_READ_WRITE` is the default binding type; `BINDING_TYPE_READ_ONLY` blocks all writes from that workspace. The same two steps exist in Catalog Explorer on the catalog's **Workspaces** tab, where clearing *All workspaces have access* is the isolation-mode change and *Assign to workspaces* is the binding, with *Change access to read-only* for the access level. Removing a workspace is *Revoke*.

There is no SQL for this. `ALTER CATALOG` covers ownership, managed location, tags, default collation, predictive optimisation and the retention period for dropped managed tables, and nothing about workspaces. Bindings are Catalog Explorer, the CLI, or the API.

Defining or editing bindings needs metastore admin, catalog ownership, or `MANAGE` on the catalog. `READ METADATA` is enough to *look* at the current bindings without being able to change them.

### What enforcement actually looks like

Binding is not just a query-time check, and that matters when you are trying to work out why a tool has stopped listing something:

- `information_schema` returns only the catalogs reachable from the current workspace.
- Catalog Explorer and the lineage graph show only the catalogs assigned to the current workspace.
- Metastore admins and catalog owners are the exception to the listing rule: they see unassigned catalogs greyed out. No child object inside them is visible or queryable.

### The default workspace catalog is already bound

Auto-enabled workspaces arrive with a workspace catalog named after the workspace, and it is the one catalog that is **not** open by default: it is bound to its own workspace only. If you unbind it or extend it to other workspaces, you have to re-grant permissions by hand, because the `workspace admins` group that owns it is a workspace-local group and has no meaning in another workspace. Use account-level groups, or individual users, for those grants.

### External locations, storage credentials and service credentials

Binding is not limited to catalogs. External locations, storage credentials and service credentials can all be restricted to named workspaces, and the reason to bother is that a catalog binding alone does not stop somebody reaching the same bytes by path. The typical pairs:

| Object | Bound so that |
| --- | --- |
| Catalog | production tables are only queryable from production workspaces |
| External location | `CREATE EXTERNAL TABLE` or `READ FILES` on production paths can only be exercised in a production workspace |
| Storage credential | production credentials can only be used to create external locations in a production workspace |

**When the check happens** differs between them, and this is the subtle part:

- An **external location** binding is checked every time a privilege on it is exercised. Running `CREATE TABLE main.silver.orders LOCATION 's3://bucket/path'` from a workspace triggers two checks on top of the user's privileges: is the external location covering that path bound to this workspace, and is the catalog bound to this workspace with read and write access. If the external location is later unbound from that workspace, the external table that was already created keeps working.
- A **storage credential** binding is checked only when an external location is created from it. After that, the external location stands on its own.

That asymmetry enables a useful pattern: populate a catalog from one central workspace that has the external location bound to it, then hand the catalog to other workspaces through catalog bindings without ever exposing the external location there. See [[external-locations-and-storage-credentials]] for what those two objects are.

## Example: development and production in one metastore

One metastore per region means development and production normally share one. The shape that keeps them apart:

```bash
# Production catalog: production workspace only, read/write.
databricks catalogs update prod --isolation-mode ISOLATED --profile prod-admin
databricks workspace-bindings update-bindings catalog prod \
  --json '{"add": [{"workspace_id": 1111111111111111, "binding_type": "BINDING_TYPE_READ_WRITE"}]}' \
  --profile prod-admin

# Analysts' BI workspace may read production, never write to it.
databricks workspace-bindings update-bindings catalog prod \
  --json '{"add": [{"workspace_id": 3333333333333333, "binding_type": "BINDING_TYPE_READ_ONLY"}]}' \
  --profile prod-admin

# Development catalog: development workspace only.
databricks catalogs update dev --isolation-mode ISOLATED --profile prod-admin
databricks workspace-bindings update-bindings catalog dev \
  --json '{"add": [{"workspace_id": 2222222222222222, "binding_type": "BINDING_TYPE_READ_WRITE"}]}' \
  --profile prod-admin

# The production storage credential can only mint locations in production.
# Same two steps, a different command group for step one.
databricks storage-credentials update prod_s3 --isolation-mode ISOLATED --profile prod-admin
databricks workspace-bindings update-bindings storage-credential prod_s3 \
  --json '{"add": [{"workspace_id": 1111111111111111}]}' \
  --profile prod-admin
```

From the development workspace, `SELECT * FROM prod.silver.orders` now fails regardless of grants, and the same code promoted across targets picks up `dev` or `prod` from its configuration rather than from a hard-coded catalog name (see [[bundles-variables-targets]]).

To see from inside a workspace what it can actually reach, read [[information-schema|the information schema]] rather than trusting the sidebar:

```sql
SELECT current_metastore(), current_catalog();

-- Returns only the catalogs this workspace is allowed to see.
SELECT catalog_name, catalog_owner
FROM system.information_schema.catalogs
ORDER BY catalog_name;
```

## Common mistakes

- **Adding bindings without setting the isolation mode.** While the mode is `OPEN` the catalog is still reachable from every attached workspace and your binding list changes nothing.
- **Treating a binding as a substitute for grants.** It is a second gate, not the first one. A workspace being bound does not give anybody `SELECT`; revoke and grant still do that work.
- **Unbinding the default workspace catalog and expecting the admins to keep their access.** The `workspace admins` group is workspace-local. Re-grant to an account-level group or to named users.
- **Binding the catalog and leaving the external location open.** Path-based access to an external table's files is a separate door; bind the external location too.
- **Expecting a read-only binding to stop a pipeline that already exists.** It blocks the write and the pipeline fails. Decide the access level before pointing jobs at the catalog.
- **Looking for `ALTER CATALOG ... SET ISOLATION MODE`.** It does not exist. Use Catalog Explorer, the CLI or the API.

> [!tip]
> Bind in this order when you are retrofitting an existing metastore: production catalog first with only the production workspace, then the production storage credentials, then the external locations. Doing it the other way round tends to break the job that populates the catalog before anyone has worked out which workspace it actually runs in.
