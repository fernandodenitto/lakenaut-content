---
id: uc-metastore-and-setup
title: The metastore and how a workspace gets Unity Catalog
area: catalog
level: beginner
summary: One metastore per cloud region holds the catalogs; the account console attaches it to workspaces; workspaces created after 8 November 2023 arrive already enabled with their own workspace catalog.
prerequisites: [unity-catalog-overview, platform-architecture]
related: [unity-catalog-overview, privileges-grant-revoke, external-locations-and-storage-credentials, system-tables, managed-vs-external-tables]
exams:
  - cert: de-associate
    domain: "Databricks Intelligence Platform"
    objective: "Understand the core components of the Databricks Data Intelligence Platform, such as its architecture, Delta Lake, and Unity Catalog."
sources:
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/setup-uc/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/enable-workspaces
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/manage-metastore
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/catalogs/default
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/connect/unity-catalog/cloud-storage/managed-storage
    checked: 2026-09-11
aliases: [metastore, workspace catalog, default catalog, metastore admin, account console, three-level namespace, enable unity catalog]
updated: 2026-09-11
status: published
maturity: ga
---

## What it is

The **metastore** is the top-level container in Unity Catalog. It holds the catalogs, and through them every schema, table, view, volume, function and model you govern. It also holds the objects that sit outside the catalog hierarchy: storage credentials, external locations, connections and shares.

A metastore is **regional**. You create one per cloud region and attach it to any number of workspaces in that region, and those workspaces then share the same objects, the same grants, the same lineage and the same audit trail. Nothing in Unity Catalog crosses a region by accident.

The metastore lives at the **account** level, which is why you create and assign it from the **account console** rather than from inside a workspace.

## Why it exists

The four words account, metastore, workspace and catalog are the ones beginners never get straight, largely because the older Hive metastore conflated them: the metastore belonged to the workspace, so "the table" and "the workspace" were one scope, and two teams with two workspaces had two copies of everything.

Unity Catalog splits them apart deliberately:

- the **account** is your Databricks contract: billing, identity, and the list of workspaces;
- the **metastore** is the governed data estate for one region, owned by the account;
- a **workspace** is a place people log into and run compute;
- a **catalog** is the top level of the data namespace inside a metastore.

Read it as two trees that meet. One is people and compute: account contains workspaces. The other is data: account contains metastores, which contain catalogs, schemas and tables. Attaching a metastore to a workspace joins them, many workspaces to one metastore. A catalog does not belong to a workspace at all, although workspace-catalog binding lets you limit which workspaces may see one.

## How it works

### The three-level namespace

Once a metastore is attached, every data object is addressed with three names, with the metastore implied because there is only one per workspace:

```
catalog.schema.object
main.silver.orders
```

Catalogs, schemas, and the objects inside them are described in [[unity-catalog-overview]], and the distinction between the tables Unity Catalog owns and the ones it only registers is in [[managed-vs-external-tables]]. What matters here is that the metastore is the fourth, unwritten level: two catalogs with the same name in two regions are two different things, and there is no syntax that reaches across. Two special catalogs are worth knowing early: `hive_metastore`, the legacy workspace-local metastore exposed as a catalog, and `system`, which holds the [[system-tables|system tables]] for the whole region.

### Automatic enablement

On **8 November 2023** Databricks started enabling new AWS workspaces for Unity Catalog automatically, rolling it out gradually (on Google Cloud the date is 6 March 2024). If your workspace was created after that, three things were done for you:

1. a metastore for the region exists and is attached to the workspace;
2. a **workspace catalog** was provisioned, named after the workspace;
3. that workspace catalog was set as the workspace's **default catalog**.

Automatically created metastores do **not** get metastore-level managed storage. That is intentional: managed storage is now assigned at the catalog level, which is covered in [[external-locations-and-storage-credentials]].

Workspaces created before the cutoff were not enabled automatically. An account admin enables one by opening the account console, choosing the metastore for the region, going to its **Workspaces** tab and assigning the workspace. Their default catalog stays `hive_metastore` until somebody changes it.

### The workspace catalog

The workspace catalog exists so that a new workspace is usable on day one without an admin designing a catalog layout first. It is deliberately generous inside its own boundary and invisible outside it:

| Question | Answer |
| --- | --- |
| Who owns it? | the workspace admins |
| Who can use it? | every user of that workspace, and only that workspace |
| What do users get on the catalog? | `USE CATALOG` |
| What do users get on its default schema? | `USE SCHEMA`, `CREATE TABLE`, `CREATE VOLUME`, `CREATE FUNCTION`, `CREATE MODEL`, `CREATE MATERIALIZED VIEW` |

It is a good sandbox and a bad production catalog. The permissions that make it convenient, everyone in the workspace can create objects, are exactly the ones you do not want on `prod`.

### The default catalog

The default catalog is what a query means when it omits the catalog name. Resolution runs in this order:

1. a session-level `USE CATALOG`, or the JDBC/ODBC setting;
2. the cluster's `spark.databricks.sql.initial.catalog.namespace` Spark configuration;
3. the workspace default catalog, set by a workspace admin under **Settings**, **Advanced**, "Default catalog for the workspace".

Changing it takes effect after warehouses and clusters restart, and it breaks any code that relied on two-level names, which is the whole point of changing it during a Hive metastore migration.

### The three admin roles

| Role | Scope | What it is for |
| --- | --- | --- |
| **Account admin** | the account | creates metastores, assigns them to workspaces, manages account-level identities |
| **Metastore admin** | one metastore | manages access to every securable in every workspace attached to that metastore, and sets the metastore storage root |
| **Workspace admin** | one workspace | workspace settings, compute policies, the default catalog; in auto-enabled workspaces they can also create metastore-level securables such as catalogs and external locations |

The metastore admin role is assigned from the account console, and an account admin can take it, hand it to someone else, or unassign it once the administration is done. Treat it the way you treat `root`: a role you step into, not one you live in. Note the asymmetry between workspaces enabled automatically and those upgraded by hand: in the first, workspace admins can create catalogs and external locations by default; in the second, they start with no more Unity Catalog access than anyone else.

## Example: finding out where you actually are

Before writing anything, check which metastore and which default catalog you are working against:

```sql
SELECT current_metastore(), current_catalog(), current_schema();
```

Then set up a proper catalog rather than working in the workspace catalog, and point it at its own managed storage:

```sql
CREATE CATALOG IF NOT EXISTS prod
  MANAGED LOCATION 's3://acme-prod-data/managed/'
  COMMENT 'Production, governed by the platform team';

CREATE SCHEMA prod.silver;

-- give the analysts the entry door, then the data
GRANT USE CATALOG ON CATALOG prod TO `analysts`;
GRANT USE SCHEMA  ON SCHEMA  prod.silver TO `analysts`;
GRANT SELECT      ON SCHEMA  prod.silver TO `analysts`;
```

To confirm a workspace is enabled at all, an account admin can look at the **Metastore** column next to the workspace in the account console; from inside the workspace, `SELECT current_metastore()` returning a value is the same answer.

## Common mistakes

- **Thinking a catalog belongs to a workspace.** It belongs to the metastore. Every attached workspace sees it unless you bind it, and a grant made in one applies in all of them.
- **Trying to attach two metastores to one workspace.** A workspace has exactly one. Data from another region is shared, not attached.
- **Building production in the workspace catalog.** Every user of the workspace can create objects in its default schema. Create a real catalog with real grants.
- **Assuming a two-level name still works after enablement.** `silver.orders` resolves against the default catalog, which on an auto-enabled workspace is the workspace catalog, not `hive_metastore`. That is usually the cause of "the table existed yesterday".
- **Leaving everyone as metastore admin.** The role can grant anything on anything in every attached workspace. Assign it for the task, then unassign.
- **Expecting the metastore to have a storage root.** Metastores created automatically do not have one; managed storage now belongs on the catalog.

> [!exam]
> Know the containment order without hesitating: account, then metastore (one per region, attached to many workspaces), then catalog, schema and object, written as `catalog.schema.object`. Know that metastores are created and attached from the **account console** by an **account admin**, that the **metastore admin** manages securables across every attached workspace, and that workspaces created after **8 November 2023** are enabled automatically with a workspace catalog named after the workspace, which also becomes the default catalog. A typical question gives a two-level table name and asks why it resolves differently in two workspaces: the default catalog setting.
