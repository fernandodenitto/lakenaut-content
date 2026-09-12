---
id: bundles-overview
title: Declarative Automation Bundles and the Databricks CLI
area: workspace
subarea: cicd
level: intermediate
summary: A bundle describes jobs, pipelines, and other assets in YAML alongside the code. With the Databricks CLI you validate, deploy, and run it, locally or from a CI/CD pipeline.
prerequisites: [git-folders, jobs-overview]
related: [bundles-variables-targets, jobs-overview, pipelines-overview, git-folders]
exams:
  - cert: de-associate
    domain: "Implementing CI/CD"
    objective: "Deploy Declarative Automation Bundles (formerly Databricks Asset Bundles) to package, configure, and promote Lakeflow Jobs, Lakeflow Spark Declarative Pipelines, and other workspace assets across dev, test, and prod environments."
  - cert: de-associate
    domain: "Implementing CI/CD"
    objective: "Understand the Databricks CLI to validate, deploy, and manage Declarative Automation Bundles (formerly Databricks Asset Bundles) and other workspace assets in automated CI/CD workflows."
sources:
  - url: https://docs.databricks.com/aws/en/dev-tools/bundles/
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/dev-tools/bundles/settings
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/dev-tools/cli/bundle-commands
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/dev-tools/cli/authentication
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/dev-tools/ci-cd/github
    checked: 2026-09-09
aliases: [databricks asset bundles, dabs, dab, bundle, databricks cli, databricks.yml]
updated: 2026-09-11
status: published
---

## What it is

A **bundle** is a project that keeps, in a single Git-versioned folder, both the code (notebooks, Python files, SQL, wheels) and the declarative definition of the Databricks resources that run it: Lakeflow Jobs, Lakeflow pipelines, dashboards, MLflow experiments and models, serving endpoints. The definition lives in `databricks.yml` and in the YAML files it includes. The **Databricks CLI** reads the bundle and turns it into real objects in the workspace.

> [!changed]
> The product is now called **Declarative Automation Bundles**; the docs refer to it as *formerly known as Databricks Asset Bundles*. The **DABs** acronym and the `databricks bundle` command are unchanged, and you will see them everywhere in training material and on the exam.

## Why it exists

A job built by hand in the dev UI has to be rebuilt by hand in test and in prod, and nobody knows whether the three copies match. A bundle is **infrastructure as code** for the workspace: the same definition is applied to multiple environments, every change goes through a commit and a PR (see [[git-folders]]), and a CI/CD pipeline can deploy without anyone clicking around in the workspace. Differences between environments are handled with targets and variables (see [[bundles-variables-targets]]).

## How it works

### Structure of `databricks.yml`

| Mapping | What it is for |
| --- | --- |
| `bundle` | bundle name (required) and optionally `databricks_cli_version`, Git metadata |
| `include` | globs of other YAML files to merge in, e.g. `resources/*.yml` |
| `variables` | variables with a description and a default |
| `workspace` | `host`, `profile`, deployment paths (`root_path`, `file_path`…) |
| `resources` | the resources: `jobs`, `pipelines`, `dashboards`, `experiments`, `models`… |
| `targets` | the environments: each can change `workspace`, `mode`, `variables` and override parts of `resources` |
| `permissions`, `run_as`, `presets`, `sync`, `artifacts` | permissions, execution identity, prefixes, files to sync, wheels to build |

Only one target can have `default: true`; that is the one used when you don't pass `-t`.

### Lifecycle with the CLI

```bash
databricks bundle init                 # scaffold from a template (default-python, default-sql, dbt-sql…)
databricks bundle validate -t dev      # check syntax, references, and variables
databricks bundle deploy -t dev        # sync the files and create/update the resources
databricks bundle run -t dev etl_vendite   # launch the job (or pipeline) and wait for the outcome
databricks bundle summary -t dev       # what was deployed and where
databricks bundle destroy -t dev       # remove deployed resources and files
```

The deploy uploads the files under a workspace path (`/Workspace/Users/<user>/.bundle/<name>/<target>` in dev) and creates the resources pointing at that source. `run` takes the resource key, not the display name, and `--params` passes job parameters. `generate` and `deployment bind` bring resources that already exist into a bundle.

### Authentication

The CLI looks for credentials in this order: settings in the bundle (`workspace.profile`, `workspace.host`), environment variables, profiles in `~/.databrickscfg`.

```bash
# developer: interactive OAuth, saves a profile
databricks auth login --host https://<workspace>.cloud.databricks.com --profile dev

# CI/CD: service principal with machine-to-machine OAuth, via environment variables
export DATABRICKS_HOST=https://<workspace>.cloud.databricks.com
export DATABRICKS_CLIENT_ID=<client-id>
export DATABRICKS_CLIENT_SECRET=<secret>
```

In the bundle, `targets.dev.workspace.profile: dev` ties the target to the profile; in CI it is better to rely on the environment variables instead.

## Example

A job declared in `resources/etl_vendite.job.yml`, included from `databricks.yml`:

```yaml
# databricks.yml
bundle:
  name: etl-sales

include:
  - resources/*.yml

targets:
  dev:
    mode: development
    default: true
    workspace:
      host: https://dev.cloud.databricks.com
  prod:
    mode: production
    workspace:
      host: https://prod.cloud.databricks.com
    run_as:
      service_principal_name: sp-etl-prod
```

```yaml
# resources/etl_vendite.job.yml
resources:
  jobs:
    etl_vendite:
      name: etl_vendite
      schedule:
        quartz_cron_expression: "0 0 6 * * ?"
        timezone_id: Europe/Rome
      tasks:
        - task_key: clean
          notebook_task:
            notebook_path: ../src/clean_vendite.py
        - task_key: aggregate
          depends_on: [{ task_key: clean }]
          notebook_task:
            notebook_path: ../src/aggrega_vendite.py
```

A minimal GitHub Actions pipeline that validates on every PR and deploys to prod on merge to `main`:

```yaml
name: bundle
on:
  pull_request:
  push:
    branches: [main]
env:
  DATABRICKS_HOST: ${{ secrets.DATABRICKS_HOST }}
  DATABRICKS_CLIENT_ID: ${{ secrets.DATABRICKS_CLIENT_ID }}
  DATABRICKS_CLIENT_SECRET: ${{ secrets.DATABRICKS_CLIENT_SECRET }}
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: databricks/setup-cli@main
      - run: databricks bundle validate -t prod
  deploy:
    if: github.ref == 'refs/heads/main'
    needs: validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: databricks/setup-cli@main
      - run: databricks bundle deploy -t prod
      - run: databricks bundle run -t prod etl_vendite
```

## Common mistakes

- Editing a bundle-deployed job in the UI: on the next deploy the CLI resets the resource to what the YAML says and the edit disappears.
- Deploying to prod from your laptop with your own credentials: the resources end up owned by the user. In prod you use `mode: production` with `run_as` set to a service principal.
- Skipping `validate` in CI: many errors (a variable with no value, a notebook path that doesn't exist) only surface there, before anything touches the workspace.
- Confusing the resource key (`etl_vendite`, used by `bundle run`) with the `name` field shown in the UI.
- Absolute workspace paths in `notebook_path`: they must be relative to the YAML file so the bundle stays portable across environments.

> [!exam]
> Expect questions on **which command does what**: `validate` checks, `deploy` creates or updates, `run` executes, `destroy` removes. Know that the main file is `databricks.yml`, that resources live under `resources` and environments under `targets`, and that a bundle promotes **the same code** across dev, test, and prod by changing only the target. The name to recognize is *Declarative Automation Bundles (formerly Databricks Asset Bundles)*; answer options may still say "DABs".
