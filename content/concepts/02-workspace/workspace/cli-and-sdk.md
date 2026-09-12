---
id: cli-and-sdk
title: The CLI and the SDKs
area: workspace
subarea: dev-tools
level: intermediate
summary: The Databricks CLI, the language SDKs, and Databricks Connect all share one authentication order and wrap the same REST API for scripting and automation.
prerequisites: [platform-architecture, jobs-overview]
related: [bundles-overview, secrets-management, git-folders]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/dev-tools/cli/
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/dev-tools/cli/authentication
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/dev-tools/auth/unified-auth
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/dev-tools/sdk-python
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/dev-tools/databricks-connect/
    checked: 2026-09-10
aliases: [databricks cli, databricks-sdk, workspaceclient, databricks connect, .databrickscfg]
updated: 2026-09-10
status: published
---

## What it is

The **Databricks CLI** is a single binary that turns every workspace and account operation into a terminal command; the **Python SDK** (`databricks-sdk`) exposes the same operations as a typed `WorkspaceClient` object for use inside scripts; **Databricks Connect** goes one step further and lets local PySpark code execute against a remote cluster instead of a local Spark session. All three, plus Terraform and the VS Code extension, resolve credentials through the same **unified authentication** mechanism, so a profile you set up once works everywhere.

## Why it exists

Clicking through the UI doesn't scale past a handful of jobs, and it can't run inside CI/CD. Once work moves into a pipeline — deploying a [[bundles-overview]] on every merge, rotating a [[secrets-management]] value, listing runs for a nightly report — something has to call the platform programmatically. The CLI covers ad hoc and scripted use from a terminal; the SDK covers the same ground from inside a larger Python (or Go, Java) program; Databricks Connect covers the case where you want to write and debug Spark code in a real IDE instead of a notebook cell.

## How it works

### Installing and configuring the CLI

```bash
curl -fsSL https://raw.githubusercontent.com/databricks/setup-cli/main/install.sh | sh
databricks auth login --host https://<workspace>.cloud.databricks.com --profile dev
```

`auth login` opens a browser-based OAuth flow (user-to-machine) and writes the result as a named **profile** in `~/.databrickscfg`:

```ini
[dev]
host = https://dev-workspace.cloud.databricks.com

[ci]
host = https://prod-workspace.cloud.databricks.com
client_id = <service-principal-client-id>
client_secret = <service-principal-oauth-secret>
```

Every command accepts `--profile`/`-p` to pick one; without it, the CLI falls back to `DEFAULT`. List what's configured with `databricks auth profiles`.

### Unified authentication order

The CLI, both SDKs, Databricks Connect, and Terraform resolve credentials the same way, stopping at the first complete method they find:

1. Explicit fields set in code (SDK only) or CLI flags.
2. Environment variables (`DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `DATABRICKS_CLIENT_ID`/`DATABRICKS_CLIENT_SECRET`, or `DATABRICKS_CONFIG_PROFILE` to point at a named profile).
3. A profile in `~/.databrickscfg` — `DEFAULT` if none is named.

Within whichever source wins, OAuth (machine-to-machine for a service principal, user-to-machine for a person) is tried before a legacy personal access token. In practice: set env vars in CI, use a named profile on a laptop, and let a bundle's `targets.<env>.workspace.profile` (see [[bundles-overview]]) pin which profile a deploy uses.

### Common commands

| Group | Does | Example |
| --- | --- | --- |
| `fs` | move files to/from volumes and workspace paths | `databricks fs cp report.csv dbfs:/Volumes/main/tmp/` |
| `jobs` | list, run, and inspect Lakeflow Jobs | `databricks jobs run-now 1234` |
| `bundle` | validate/deploy/run a bundle (see [[bundles-overview]]) | `databricks bundle deploy -t prod` |
| `sql` | run a statement against a SQL warehouse | `databricks sql -e "SELECT 1"` |

Every command is a thin wrapper over the REST API: `databricks clusters get 1234-567890-a12b` and the equivalent authenticated `curl` call to `/api/2.1/clusters/get` return the same JSON.

### The Python SDK

```python
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()  # resolves credentials via unified auth, same as the CLI

for job in w.jobs.list():
    print(job.job_id, job.settings.name)

run = w.jobs.run_now(job_id=1234).result()  # blocks until the run finishes
```

`WorkspaceClient()` with no arguments picks up the same profile or environment variables the CLI would use — there's no separate SDK-only configuration to maintain. An `AccountClient` exists in parallel for account-level operations (workspaces, account groups) rather than a single workspace.

### Databricks Connect

Where the CLI and SDK call the control plane (create a cluster, start a job, list secrets), Databricks Connect targets the **data plane**: it opens a Spark Connect session so `pyspark` code written and debugged in a local IDE executes on a remote cluster, streaming results back only when you call `.collect()` or `.show()`. It's the tool for writing and testing Spark logic outside a notebook, not for orchestrating the workspace itself.

### CLI vs. SDK vs. REST vs. Connect

| Need | Use |
| --- | --- |
| One-off command from a terminal or a shell script | CLI |
| Logic embedded in a larger Python program | Python SDK |
| Local IDE debugging of actual Spark transformations | Databricks Connect |
| A language with no SDK, or the absolute latest API surface | Raw REST API |
| Deploying jobs/pipelines as code | `databricks bundle` (CLI) |

## Common mistakes

- Hardcoding a host and token in a script instead of relying on unified auth — it breaks the moment the same script runs in a different environment.
- Using a personal profile (OAuth U2M) for a scheduled job: prefer a service principal profile with OAuth M2M, the same identity a bundle would `run_as` (see [[bundles-overview]]).
- Reaching for Databricks Connect to run a job or manage clusters — that's SDK/CLI territory; Connect is for executing DataFrame code, not orchestration.
- Forgetting `--profile` and silently hitting `DEFAULT`, which may point at the wrong workspace on a machine with several configured.
- Storing a service principal's `client_secret` directly in `.databrickscfg` on a shared machine instead of in environment variables injected by the CI system, or a proper [[secrets-management]] store.

## Example

```bash
# CI job: validate and deploy a bundle using a service principal profile
export DATABRICKS_CONFIG_PROFILE=ci
databricks bundle validate -t prod
databricks bundle deploy -t prod
```

```python
# Same workspace, from a Python script using the SDK
from databricks.sdk import WorkspaceClient

w = WorkspaceClient(profile="ci")
job = w.jobs.get(job_id=1234)
print(f"Next run of {job.settings.name} uses profile 'ci', not a personal token")
```

> [!tip]
> Set up one profile per environment in `.databrickscfg`, name jobs and bundles after it with `-t`/`--profile`, and you'll never need to touch a raw REST call for day-to-day work — the CLI and SDK cover it.
