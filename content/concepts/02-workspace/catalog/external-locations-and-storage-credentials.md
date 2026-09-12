---
id: external-locations-and-storage-credentials
title: External locations and storage credentials
area: catalog
level: intermediate
summary: A storage credential holds the cloud identity, an external location binds that credential to a path, and the privileges on the location decide who may read, write or create tables there.
prerequisites: [unity-catalog-overview, managed-vs-external-tables]
related: [managed-vs-external-tables, privileges-grant-revoke, workspace-files-volumes, unity-catalog-overview, secrets-management]
exams:
  - cert: de-associate
    domain: "Governance and Security"
    objective: "Create and operate external tables in Unity Catalog, including the cloud storage access they depend on."
sources:
  - url: https://docs.databricks.com/aws/en/connect/unity-catalog/cloud-storage/
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/connect/unity-catalog/cloud-storage/storage-credentials
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/connect/unity-catalog/cloud-storage/external-locations
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/connect/unity-catalog/cloud-storage/manage-external-locations
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/connect/unity-catalog/cloud-storage/managed-storage
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/connect/unity-catalog/cloud-services/service-credentials
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/connect/unity-catalog/cloud-services/use-service-credentials
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-ddl-create-location
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/connect/unity-catalog/cloud-storage/s3/s3-external-location-manual
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/data-governance/unity-catalog/access-control/privileges-reference
    checked: 2026-09-11
aliases: [storage credential, external location, service credential, READ FILES, WRITE FILES, instance profile, managed storage location]
updated: 2026-09-11
status: published
maturity: ga
---

## What it is

Two securable objects sit directly under the metastore, and together they are the only sanctioned route from Databricks to a cloud bucket.

A **storage credential** wraps a long-lived cloud identity: on AWS an IAM role, on Cloudflare R2 an API token. It answers "with what authority do we call the storage service?" and nothing else. It has no path.

An **external location** combines a cloud storage path with the storage credential that authorises it. It answers "which prefix, and who may do what there?" Privileges are granted on the location, not on the credential, and one credential can back many locations.

[[managed-vs-external-tables]] describes the table on each side of that line. This page is the layer underneath: the objects that make `LOCATION 's3://...'` legal in the first place.

## Why it exists

Before Unity Catalog, storage access was a property of **compute**. You attached an instance profile to a cluster, or mounted a bucket with keys from a secret scope, and anyone who could attach to that cluster inherited the whole bucket. Permissions were effectively "which cluster are you on", which does not survive a new cluster, cannot express "read this prefix, write that one", and produces no usable audit trail.

Moving the credential into the catalogue inverts that. The identity is held once, by the metastore, users never see it, and what they can do is decided by grants on a path evaluated per query. Compute becomes irrelevant to authorisation, which is what you want when the same table is read from a job, a warehouse and a notebook.

## How it works

### Creating the pair

Creating a storage credential needs `CREATE STORAGE CREDENTIAL` on the metastore, held by default by account and metastore admins and by workspace admins in workspaces enabled for Unity Catalog automatically (see [[uc-metastore-and-setup]]). On AWS you create it in Catalog Explorer, or through the API or CLI, with a name and the ARN of the IAM role; there is no documented SQL statement for this step.

Creating an external location needs two privileges at once: `CREATE EXTERNAL LOCATION` on the **metastore** and `CREATE EXTERNAL LOCATION` on the **storage credential** you point at. A metastore admin has both.

```sql
CREATE EXTERNAL LOCATION IF NOT EXISTS prod_sales
  URL 's3://acme-prod-data/sales/'
  WITH (STORAGE CREDENTIAL acme_prod_role)
  COMMENT 'Sales landing and external tables';

CREATE EXTERNAL LOCATION prod_finance
  URL 's3://acme-prod-data/finance/'
  WITH (STORAGE CREDENTIAL acme_prod_role);

DESCRIBE EXTERNAL LOCATION prod_sales;
```

That is the shape of a real deployment: one IAM role per bucket or per environment, then a location per prefix that a different group of people cares about, each with its own grants.

### The privileges that matter

On an **external location**:

| Privilege | What it allows |
| --- | --- |
| `READ FILES` | read files at the path directly, for example with `read_files` or a `cloudFiles` stream |
| `WRITE FILES` | write files at the path directly |
| `CREATE EXTERNAL TABLE` | register an external table whose `LOCATION` falls inside this path |
| `CREATE EXTERNAL VOLUME` | register an external volume at this path (see [[workspace-files-volumes]]) |
| `CREATE MANAGED STORAGE` | use this path as the managed location of a catalog or schema |
| `BROWSE` | see that the location exists without any data access |
| `EXTERNAL USE LOCATION`, `CREATE FOREIGN SECURABLE`, `READ METADATA`, `MANAGE`, `ALL PRIVILEGES` | external engines, foreign securables, metadata, administration, everything |

```sql
GRANT READ FILES, WRITE FILES, CREATE EXTERNAL TABLE
  ON EXTERNAL LOCATION prod_sales TO `data-engineering`;
```

A **storage credential** carries a similar-looking set (`READ FILES`, `WRITE FILES`, `CREATE EXTERNAL TABLE`, `CREATE EXTERNAL LOCATION`, `READ METADATA`, `MANAGE`), and you should almost never grant the first three: on the credential they apply to everything that credential can reach, usually the whole bucket, bypassing the per-prefix control you built the locations for. Grant on the location; keep the credential for admins.

An external location can also be marked **read-only**, which blocks writes no matter what the underlying IAM role is permitted to do. That is the cheapest way to make "we only consume this vendor drop" enforceable rather than aspirational. New external locations also get **file events** enabled by default, which is what lets [[auto-loader]] use notifications instead of listing.

### Managed storage locations

Managed tables need somewhere to live too, and that somewhere is a **managed storage location**, set at the metastore, catalog or schema level. The most specific one wins: schema, then catalog, then metastore. Databricks recommends assigning it at the **catalog** level, and metastores created automatically no longer get metastore-level storage at all.

```sql
CREATE CATALOG prod MANAGED LOCATION 's3://acme-prod-data/managed/';
```

The rules are strict on purpose. A catalog or schema managed location must be contained within an external location, and you need `CREATE MANAGED STORAGE` on that location. It must not overlap an external table or external volume, and the metastore-level one must not overlap any external location. Unity Catalog does not write your tables at the path you gave it either: it treats that path as the storage root and appends a hashed subdirectory under `__unitystorage`, so two catalogs sharing a root never collide. The path itself is limited to 150 characters.

### The warning worth taking seriously

Do not give identities outside Unity Catalog storage-level access to managed tables or volumes. A bucket policy that lets a Glue job or an EC2 role read the managed prefix directly defeats every control on this page: nothing is evaluated, nothing is audited, and a write from outside corrupts the transaction log Unity Catalog believes it owns.

### Service credentials, the non-storage counterpart

A **service credential** is the same idea aimed at cloud services rather than cloud storage: AWS Secrets Manager, AWS Glue, and similar. Creating one needs `CREATE SERVICE CREDENTIAL` on the metastore; using one needs `ACCESS` on the credential, or ownership of it.

The documentation is explicit that service credentials are the Unity Catalog alternative to **instance profiles**, for the reason that runs through this whole page: access is tied to users, groups and service principals, not to a compute resource. In code you ask for a credential provider by name:

```python
import boto3

session = boto3.Session(
    botocore_session=dbutils.credentials.getServiceCredentialsProvider("acme_secrets_reader"),
    region_name="eu-west-1",
)
secrets = session.client("secretsmanager")
```

Setting `DATABRICKS_DEFAULT_SERVICE_CREDENTIAL_NAME` on the compute lets you omit the name; it needs Databricks Runtime 16.2 and above and is not supported on SQL warehouses. This is not [[secrets-management]]: a secret scope hands you a string, a service credential hands you an authenticated client.

## Example: a vendor drop, governed end to end

A vendor writes Parquet into a prefix you must never write back to, and one team may build tables on it. Step one is in Catalog Explorer: a storage credential `acme_landing_role` pointing at an IAM role that can read `s3://acme-landing/`. The rest is SQL.

```sql
-- a location scoped to the vendor prefix
CREATE EXTERNAL LOCATION vendor_a
  URL 's3://acme-landing/vendor-a/'
  WITH (STORAGE CREDENTIAL acme_landing_role)
  COMMENT 'Read-only drop from vendor A';

-- read, and the right to register tables; no WRITE FILES
GRANT READ FILES, CREATE EXTERNAL TABLE
  ON EXTERNAL LOCATION vendor_a TO `data-engineering`;
GRANT BROWSE ON EXTERNAL LOCATION vendor_a TO `analysts`;

-- now the external table is legal
CREATE TABLE prod.bronze.vendor_a
USING PARQUET
LOCATION 's3://acme-landing/vendor-a/orders/';
```

With `WRITE FILES` withheld, an accidental `INSERT` into `prod.bronze.vendor_a` fails on the location privilege, not on a bucket policy somebody has to remember to keep right.

## Common mistakes

- **Confusing the two objects.** The credential is the key, the location is the door it opens. Privileges belong on the door.
- **Granting `READ FILES` or `WRITE FILES` on the storage credential.** That is bucket-wide access which skips every external location you defined.
- **Creating one external location for the whole bucket.** It becomes your only unit of granting, and every later grant is coarser than you wanted.
- **Leaving the old instance profile attached "just in case".** Two routes to the same data make the governed one optional, and the ungoverned one wins whenever somebody is in a hurry.
- **Pointing a catalog's `MANAGED LOCATION` at a prefix that already holds external tables.** Overlap is not allowed, and the failure surfaces later as confusing path errors.

> [!exam]
> The exam expects the pair and their order: a storage credential wraps the cloud identity, an external location binds it to a path, and you cannot create an external table without `CREATE EXTERNAL TABLE` on the location containing the `LOCATION` path (plus `USE CATALOG`, `USE SCHEMA` and `CREATE TABLE` above it). Remember `READ FILES` and `WRITE FILES` as the direct-file-access privileges, that one credential can serve many locations but not the reverse, and that service credentials, not instance profiles, are how Unity Catalog reaches other cloud services.
