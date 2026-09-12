---
id: bundles-variables-targets
title: "Bundles: variables, targets, and per-environment overrides"
area: workspace
subarea: cicd
level: intermediate
summary: The same bundle is promoted across dev, test, and prod thanks to variables with defaults, target overrides, ${…} substitutions, and the development and production modes.
prerequisites: [bundles-overview, jobs-overview]
related: [bundles-overview, git-folders, jobs-parameters, compute-options]
exams:
  - cert: de-associate
    domain: "Implementing CI/CD"
    objective: "Understand environment-specific configuration using Automation Bundle (formerly Databricks Asset Bundles) variables and overrides while promoting the same codebase across dev, test, and prod targets."
sources:
  - url: https://docs.databricks.com/aws/en/dev-tools/bundles/variables
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/dev-tools/bundles/deployment-modes
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/dev-tools/bundles/settings
    checked: 2026-09-09
aliases: [bundle variables, bundle targets, deployment modes, development mode, production mode, presets]
updated: 2026-09-09
status: published
---

## What it is

In a bundle (see [[bundles-overview]]), **variables** are named values that the YAML references with `${var.name}`; **targets** are the deployment environments (dev, test, prod), each with its own workspace, its own `mode`, and the ability to override variables and pieces of resources. Together they let you keep **a single definition** of the job and change only what depends on the environment: catalog, warehouse, schedule, identity.

## Why it exists

Without variables you would end up with three copies of `databricks.yml` that drift apart over time. With variables and targets, promoting from dev to prod is the same command with a different `-t`, and the code you tested is exactly the code that goes to production.

## How it works

### Declaring variables

```yaml
variables:
  catalog:
    description: Target catalog
    default: dev
  warehouse_id:
    description: SQL warehouse for SQL tasks
    lookup:
      warehouse: "Shared Warehouse"        # resolves the id from the name
  cluster_spec:
    type: complex                          # structured value
    default:
      spark_version: 16.4.x-scala2.12
      node_type_id: m5.xlarge
      num_workers: 2
```

A variable without a `default` must receive a value at deploy time, otherwise `validate` fails. `lookup` searches for an existing object by name (cluster, warehouse, instance pool, job, pipeline, cluster policy, dashboard, alert, notification destination, service principal, metastore) and returns its id. `type: complex` accepts maps and lists, which is handy for defining a whole cluster once.

### Where values come from

Precedence from highest to lowest:

1. the `--var="catalog=prod"` flag on the CLI (repeatable, or comma-separated values);
2. the `BUNDLE_VAR_catalog=prod` environment variable;
3. the `.databricks/bundle/<target>/variable-overrides.json` file;
4. the `variables` mapping inside the target;
5. the `default` in the declaration.

### Substitutions

Beyond `${var.x}`, the bundle exposes context values:

| Substitution | Value |
| --- | --- |
| `${bundle.name}`, `${bundle.target}` | bundle name, current target |
| `${workspace.host}`, `${workspace.root_path}`, `${workspace.file_path}` | URL and deployment paths |
| `${workspace.current_user.userName}`, `${workspace.current_user.short_name}` | who is deploying |
| `${resources.jobs.etl_vendite.id}` | id of a bundle resource after deploy |

`${bundle.target}` is the clean way to build environment-dependent names without adding yet another variable.

### Targets and modes

| | `mode: development` | `mode: production` |
| --- | --- | --- |
| Resource names | `[dev <user>]` prefix | unchanged |
| Schedules and triggers | paused | active |
| Concurrent runs | allowed | as defined in the job |
| Tags | `dev` added to jobs and pipelines | none |
| Deploy lock | disabled | enabled |
| Identity | the user | explicit `run_as`, service principal recommended |
| Extra checks | `--cluster-id` override allowed | non-personal paths, Git branch verified if declared |

**Presets** fine-tune the mode's behavior: `name_prefix`, `trigger_pause_status`, `jobs_max_concurrent_runs`, `pipelines_development`, `tags`. Settings on the individual resource win over presets, which win over the mode defaults.

### Resource overrides in a target

A target can redefine only the fields that change: the CLI merges them with the main definition. Typical for schedules, worker counts, notifications.

## Example

```yaml
bundle:
  name: etl-sales

variables:
  catalog:
    default: dev
  workers:
    default: 1

resources:
  jobs:
    etl_vendite:
      name: etl_vendite_${bundle.target}
      job_clusters:
        - job_cluster_key: main
          new_cluster:
            spark_version: 16.4.x-scala2.12
            node_type_id: m5.xlarge
            num_workers: ${var.workers}
      tasks:
        - task_key: clean
          job_cluster_key: main
          notebook_task:
            notebook_path: ./src/clean.py
            base_parameters:
              catalog: ${var.catalog}

targets:
  dev:
    mode: development
    default: true
    workspace:
      host: https://dev.cloud.databricks.com

  test:
    mode: production
    workspace:
      host: https://test.cloud.databricks.com
    variables:
      catalog: test
    presets:
      name_prefix: "test_"
    run_as:
      service_principal_name: sp-etl-test

  prod:
    mode: production
    workspace:
      host: https://prod.cloud.databricks.com
    variables:
      catalog: prod
      workers: 8
    run_as:
      service_principal_name: sp-etl-prod
    resources:
      jobs:
        etl_vendite:
          schedule:
            quartz_cron_expression: "0 0 6 * * ?"
            timezone_id: Europe/Rome
          email_notifications:
            on_failure: [data-oncall@example.com]
```

```bash
databricks bundle deploy -t dev                       # job "[dev mario] etl_vendite_dev", schedule paused
databricks bundle deploy -t test                      # job "test_etl_vendite_test", test catalog
databricks bundle deploy -t prod --var="workers=12"   # one-off override, wins over the target
```

The notebook reads the catalog from the parameter (`dbutils.widgets.get("catalog")`, see [[jobs-parameters]]) and never contains a hard-coded environment name.

## Common mistakes

- Hard-coding `prod` in the code or in the main YAML instead of in a variable: the dev deploy writes to the wrong catalog.
- Expecting a job in `development` mode to start on its own: schedules are paused by design; you launch it with `bundle run` or set `pause_status: UNPAUSED` on the resource.
- `mode: production` without `run_as` and with paths under `/Users/<user>`: validation flags it, and in any case production would end up tied to one person.
- Overriding the entire job in the target instead of only the fields that change: you duplicate the definition and lose the single-source benefit.
- Forgetting the precedence order: a `BUNDLE_VAR_` left behind in the CI environment wins over the target's variables and nobody can figure out where the value is coming from.

> [!exam]
> The exam wants you to know **where** an environment difference goes: in `variables` with a `default`, overridden in the `target` or with `--var`, never in the code. Recognize `${var.x}` and `${bundle.target}`, and the effects of `mode: development` (`[dev user]` prefix, paused schedules) versus `mode: production` (clean names, `run_as` set to a service principal). Typical question: "same job, different catalog in dev and prod" → a `catalog` variable with a per-target override.
