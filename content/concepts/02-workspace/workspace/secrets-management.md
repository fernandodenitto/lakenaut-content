---
id: secrets-management
title: Secrets and credentials
area: workspace
subarea: security
level: intermediate
summary: Secret scopes store credentials outside your code, dbutils.secrets.get and the SQL secret() function redact them on read, and automation should use OAuth, not tokens.
prerequisites: [notebooks-basics, privileges-grant-revoke]
related: [cli-and-sdk, jobs-parameters, unity-catalog-overview]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/security/secrets/
    checked: 2026-09-10
aliases: [secret scope, dbutils.secrets, secrets api, credentials, service principal]
updated: 2026-09-10
status: published
---

## What it is

A **secret** is a key-value pair stored outside your notebooks and job definitions, so a database password or an API key never appears as a literal string in code that gets committed, shared, or logged. Secrets live inside a **secret scope**, a named container you create once and then reference by `scope` and `key` wherever the credential is needed.

## Why it exists

Pasting a password into a notebook cell puts it in the notebook's revision history, in any [[git-folders]] commit if the file is versioned, and on screen for anyone with read access to that notebook. A secret scope decouples the credential from the code: the code says "give me the value for key `db_password` in scope `warehouse`", the platform resolves it at runtime and actively tries to keep the resolved value out of any output.

## How it works

### Scope types

On AWS (and GCP), a secret scope is always **Databricks-backed**: an encrypted store owned and managed by the platform, created with the CLI or the Secrets API. Azure workspaces have a second option, an **Azure Key Vault-backed** scope, which is a read-only proxy over secrets you still manage in Key Vault — mentioned here only because you'll see the distinction in cross-cloud material; on AWS there's nothing to choose.

```bash
databricks secrets create-scope warehouse
databricks secrets put-secret --json '{
  "scope": "warehouse",
  "key": "db_password",
  "string_value": "s3cr3t"
}'
```

### Reading a secret

Inside a notebook or job, `dbutils.secrets.get` resolves the value at runtime:

```python
password = dbutils.secrets.get(scope="warehouse", key="db_password")
```

Whatever notebook code does with `password` afterward — print it, assign it to another variable, put it in an f-string — Databricks intercepts the literal value and prints `[REDACTED]` instead. Redaction only catches the value itself, not a deliberate transformation of it (base64-encoding it defeats the check), so ACLs on the scope still matter more than redaction.

### The `secret()` SQL function

The same lookup is available from SQL, mainly for reading a credential into a query or a Spark configuration without a Python cell:

```sql
SELECT * FROM read_files(
  's3://vendor-bucket/feed/',
  format => 'csv',
  header => true
);
-- a connection string built from a secret
SET var.conn = secret('warehouse', 'db_password');
```

Query (DQL) statements that call `secret()` are redacted the same way as `dbutils.secrets.get`; write (DML) statements are blocked outright unless the value is wrapped in something like `sha()` or `aes_encrypt()`, so a raw secret can't end up stored unencrypted in a table.

### Permissions on a scope

The user who runs `create-scope` gets `MANAGE` on it by default (read, write, and grant permissions to others). Everyone else needs an explicit ACL:

```bash
databricks secrets put-acl warehouse sp-etl-prod READ
databricks secrets list-acls warehouse
```

Grant `READ` to whoever (or whatever service principal) only needs to consume the secret at runtime, and reserve `MANAGE`/`WRITE` for the people who rotate it. ACLs are scope-wide, so a scope holding several unrelated keys means everyone with `READ` sees all of them — split scopes by application or team rather than by individual.

### Secrets vs. service principals vs. personal access tokens

A secret scope is for *credentials your code needs to reach something else* (a database, a SaaS API). For calling Databricks itself from a script, CLI, or CI/CD pipeline, that's a separate decision:

| Identity | Good for | Avoid because |
| --- | --- | --- |
| Personal access token (PAT) | quick manual testing | tied to a person; breaks when they leave or rotate it; no fine-grained scope |
| Service principal + OAuth (M2M) | jobs, CI/CD, [[cli-and-sdk]] automation | — (this is the recommended path) |

A PAT inherits the issuing user's exact permissions and has no separate identity in audit logs beyond that user — a job authenticated with someone's PAT looks, in every log, like that person ran it manually. A **service principal** is its own identity with OAuth machine-to-machine credentials that can be rotated and scoped independently of any human account, which is why bundle deploys (see [[bundles-overview]]) and scheduled jobs should run as one.

## Example

```python
# Notebook: connect to an external Postgres instance
host = "vendor-db.example.com"
password = dbutils.secrets.get(scope="warehouse", key="db_password")

jdbc_url = f"jdbc:postgresql://{host}:5432/sales"
df = (
    spark.read.format("jdbc")
    .option("url", jdbc_url)
    .option("dbtable", "orders")
    .option("password", password)
    .load()
)
print(password)  # prints [REDACTED], not the real value
```

## Common mistakes

- Storing a credential as a workspace file or a job parameter instead of a secret — see [[workspace-files-volumes]] and [[jobs-parameters]].
- Assuming redaction makes a scope safe to open to everyone: `READ` still lets a user retrieve and exfiltrate the raw value deliberately; ACLs are the real control.
- Sharing one scope across every application "for simplicity", so a contractor who needs one API key ends up with read access to all of them.
- Running a production job under a developer's PAT: it silently stops working the day that person's account is deactivated.
- Trying to `SELECT secret(...)` in a table-writing statement and being surprised when Databricks blocks it — that block is intentional.

> [!tip]
> Treat "who can read this scope" as the real security boundary, not the `[REDACTED]` output — and default automation to a service principal with OAuth instead of a personal access token from day one.
