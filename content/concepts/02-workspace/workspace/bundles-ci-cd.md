---
id: bundles-ci-cd
title: Bundles in a CI/CD pipeline
area: workspace
subarea: cicd
level: intermediate
summary: "The documented flow for deploying a bundle from a build server: compile and test, upload a versioned artifact, validate, deploy. Separate dev, staging and production workspaces, and OIDC instead of tokens."
prerequisites: [bundles-overview, bundles-variables-targets]
related: [bundles-overview, bundles-variables-targets, git-folders, cli-and-sdk, secrets-management]
exams:
  - cert: de-associate
    domain: "Implementing CI/CD"
    objective: "Automate validation and deployment of Declarative Automation Bundles from a CI/CD system across development, staging, and production workspaces."
sources:
  - url: https://docs.databricks.com/aws/en/dev-tools/ci-cd/flows
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/dev-tools/ci-cd/github
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/dev-tools/auth/oauth-federation
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/dev-tools/auth/provider-github
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/dev-tools/cli/reference/fs-commands
    checked: 2026-09-12
aliases:
  [
    ci/cd,
    github actions,
    workload identity federation,
    oidc,
    github-oidc,
    setup-cli,
    dabs ci,
    databricks asset bundles ci,
  ]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

This is a **Declarative Automation Bundle**, the project described in [[bundles-overview]], driven by a build server instead of by a person at a terminal. Databricks documents a four-stage flow for it: compile and test the code, upload the compiled file under a version, validate the bundle, deploy the bundle. Four commands, in that order, is most of the work.

The part that decides whether the pipeline is any good is the three constraints around those commands. Development, staging and production are **separate workspaces**, not separate folders in one workspace. The branch model is **trunk-based**, so `main` is always in a deployable state. And the identity the pipeline authenticates with holds **no long-lived secret**: Databricks recommends workload identity federation for CI/CD authentication, which is the recommendation that matters most in a page full of recommendations.

## Why it exists

The default way a bundle gets into production is somebody running `databricks bundle deploy -t prod` from their laptop. It works, and it leaves you with resources owned by a named person, no record of which commit is running, and a personal access token in a shell history. When that person leaves, production is orphaned.

The intermediate step people take is to move the same command into CI with a service principal token in the secrets store. That fixes ownership and leaves you with a credential to rotate, a credential that anybody with write access to the workflow file can exfiltrate, and no answer to "which build is live". The documented flow closes both gaps: the artifact carries the commit hash, so the question of what is running has an answer, and federation removes the credential entirely.

## How it works

### The four stages

| Stage            | Triggered by                                  | What runs                                                                       | Output                                                                             |
| ---------------- | --------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Compile and test | a pull request, or a commit to `main`         | your build tool plus unit tests (pytest for Python, ScalaTest for Scala)        | a versioned file, for example `my-app-1.0.jar`                                     |
| Upload and store | a green build                                 | `databricks fs cp` into a Unity Catalog volume, or a push to S3 or Blob Storage | an immutable path keyed by the commit, `.../my-app-<sha>.jar`                      |
| Validate         | the pull request, and again before any deploy | `databricks bundle validate -t <target>`                                        | a failure on a missing library, an unresolved variable, a path that does not exist |
| Deploy           | a merge to `main`                             | `databricks bundle deploy -t <target>`                                          | resources created or updated in the target workspace                               |

All four stages run through the [[cli-and-sdk|Databricks CLI]], installed in the runner by the `databricks/setup-cli` action. `deploy` validates the bundle on its own, so a separate validate step is not strictly required. Run it anyway, as its own job on the pull request: a bad configuration then fails the PR, where the author is still looking, rather than the deploy, where nobody is.

Bundles are not the only documented pattern. A workflow can instead keep a workspace [[git-folders|Git folder]] in step with a branch by running `databricks repos update /Workspace/<path> --branch <branch>`, which is source control without infrastructure as code. It is the lighter option, and it deploys nothing.

### Three workspaces, one bundle

The isolation rule in the documentation is blunt: maintain separate workspaces for development, staging and production. The bundle side of that is one target per workspace, each with its own `host`, its own `mode`, and its own variable values, as in [[bundles-variables-targets]]. Promotion is the same repository at the same commit with a different `-t`, which is the whole point: the code that passed staging is byte-for-byte the code that reaches production.

### Trunk-based, with versioned artifacts

Databricks recommends a trunk-based branching strategy to minimise merge conflicts and keep `main` deployable, and to always use versioned artifacts, such as Git commit hashes, when uploading to Databricks or to external storage, for traceability and rollback. Those two recommendations are one idea. If the artifact path contains the commit, rollback is a redeploy pointing at the previous path. If it does not, rollback is a rebuild, and a rebuild of a three-week-old commit is not a rollback, it is a gamble.

### Authentication by federation, not by token

Workload identity federation, also called OIDC, lets a workflow authenticate as a Databricks service principal using a token the CI runtime issues. The CLI and the SDKs fetch that token and exchange it for a Databricks OAuth token on their own, so nothing in the repository holds a Databricks secret. Setup is two things: a federation policy on the service principal, and three environment variables in the workflow.

| Policy field  | Value for GitHub Actions                                                              |
| ------------- | ------------------------------------------------------------------------------------- |
| Issuer URL    | `https://token.actions.githubusercontent.com`                                         |
| Entity type   | `Branch` is the default; Databricks recommends `Environment`                          |
| Subject       | `repo:<org>/<repo>:environment:<Environment>`                                         |
| Audiences     | your Databricks account ID, which is also the default if omitted                      |
| Subject claim | `sub`, unless you authenticate as a reusable workflow, where it is `job_workflow_ref` |

```bash
databricks account service-principal-federation-policy create 5581763342009999 --json '{
  "oidc_policy": {
    "issuer": "https://token.actions.githubusercontent.com",
    "audiences": ["<account-id>"],
    "subject": "repo:my-github-org/my-repo:environment:Prod"
  }
}'
```

The subject in the policy must match the subject in the token exactly. In the workflow that means `environment: Prod` on the job, `permissions: id-token: write`, and `DATABRICKS_AUTH_TYPE: github-oidc`, `DATABRICKS_HOST`, `DATABRICKS_CLIENT_ID` (the service principal's application ID) in `env`.

One caveat on the tooling: the GitHub Actions page carries a Public Preview banner, and its examples install the CLI with `databricks/setup-cli@main`, a moving branch. Pin the CLI you expect by setting `bundle.databricks_cli_version` in `databricks.yml`, so a CLI release cannot change what your pipeline deploys.

## Example: validate on the pull request, deploy on merge

```yaml
# .github/workflows/bundle.yml
name: bundle

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  id-token: write # without this GitHub issues no OIDC token and the exchange fails
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: pip install -e '.[dev]'
      - run: pytest tests/unit
      - run: python -m build --wheel
      - uses: actions/upload-artifact@v4
        with:
          name: wheel
          path: dist/*.whl

  validate:
    needs: test
    runs-on: ubuntu-latest
    environment: Staging
    env:
      DATABRICKS_AUTH_TYPE: github-oidc
      DATABRICKS_HOST: ${{ vars.DATABRICKS_HOST_STAGING }}
      DATABRICKS_CLIENT_ID: ${{ vars.DATABRICKS_CLIENT_ID_STAGING }}
    steps:
      - uses: actions/checkout@v4
      - uses: databricks/setup-cli@main
      - run: databricks bundle validate -t staging

  deploy_prod:
    if: github.ref == 'refs/heads/main'
    needs: validate
    runs-on: ubuntu-latest
    environment: Prod # must match the subject in the federation policy
    env:
      DATABRICKS_AUTH_TYPE: github-oidc
      DATABRICKS_HOST: ${{ vars.DATABRICKS_HOST_PROD }}
      DATABRICKS_CLIENT_ID: ${{ vars.DATABRICKS_CLIENT_ID_PROD }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: wheel
          path: dist
      - uses: databricks/setup-cli@main
      - name: Upload the wheel under its commit
        run: |
          databricks fs cp dist/*.whl \
            dbfs:/Volumes/main/artifacts/wheels/etl-${{ github.sha }}.whl --overwrite
      - run: databricks bundle deploy -t prod --var="wheel_version=${{ github.sha }}"
      - run: databricks bundle run -t prod etl_sales
```

The bundle takes the commit as a variable and builds the library path from it, so the deployed job points at the exact wheel this run produced:

```yaml
variables:
  wheel_version:
    description: Git commit that produced the wheel

resources:
  jobs:
    etl_sales:
      name: etl_sales
      tasks:
        - task_key: transform
          notebook_task:
            notebook_path: ../src/transform.py
          libraries:
            - whl: /Volumes/main/artifacts/wheels/etl-${var.wheel_version}.whl
```

To roll back, redeploy with the previous `--var="wheel_version=..."`. No rebuild, no branch surgery.

## Common mistakes

- **Keeping a personal access token in CI because the first example you found used one.** The documentation contains both patterns, and only one is recommended. Federation removes the secret, so there is nothing to leak and nothing to rotate.
- **A federation policy subject that does not match the token.** Drop `environment: Prod` from the job and GitHub issues a branch subject instead, the exchange fails, and the error tells you very little. Check the subject string character by character.
- **Uploading the artifact as `latest.whl`.** You now cannot say which commit is in production, and rollback becomes a rebuild of old source against today's dependency versions.
- **One workspace, three folders.** A name prefix is not isolation: a permission mistake, a runaway cluster, or a `DROP TABLE` in dev reaches production. Separate workspaces are the documented boundary.
- **Letting a feature branch deploy to prod.** Trunk-based only works if `main` is the sole source of production deploys; guard the deploy job with `if: github.ref == 'refs/heads/main'` and a protected GitHub environment.
- **Testing nothing and calling `validate` a test.** `validate` checks the configuration, not the transformation. The unit tests in stage one are what stop a wrong number reaching a dashboard.

> [!exam]
> The Implementing CI/CD domain asks for the flow in order: compile and test, upload a versioned artifact, validate, deploy. Know that `validate` is the cheap gate you put on the pull request, that the same bundle reaches dev, staging and production by changing only the target, that Databricks requires **separate workspaces** per environment, and that the recommended CI authentication is **workload identity federation**, not a personal access token. Answer options may still call bundles Databricks Asset Bundles.
