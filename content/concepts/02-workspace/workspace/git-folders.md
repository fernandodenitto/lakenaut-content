---
id: git-folders
title: "Git folders: branches, commits, pull requests"
area: workspace
subarea: git
level: beginner
summary: A Git folder is a clone of a repository inside the workspace. From the UI you create branches, commit and push, resolve conflicts, and open the pull request on the provider.
prerequisites: [platform-architecture, jobs-overview]
related: [bundles-overview, bundles-variables-targets, jobs-overview]
exams:
  - cert: de-associate
    domain: "Implementing CI/CD"
    objective: "Manage your code development workflow within the Databricks workspace UI, including creating and switching between branches in Databricks Git Folders (formerly Databricks Repos), committing and pushing changes, and creating pull requests using Databricks Git integration."
sources:
  - url: https://docs.databricks.com/aws/en/repos/
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/repos/git-operations-with-repos
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/repos/get-access-tokens-from-git-provider
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/repos/limits
    checked: 2026-09-09
aliases: [repos, databricks repos, git integration, git folder]
updated: 2026-09-09
status: published
---

## What it is

A **Git folder** is a folder in the [[workspace]] that is also a clone of a remote Git repository. Inside it you work as in any other folder (notebooks, `.py`, `.sql`, YAML files), but on top of that you get a visual Git client: branch, commit, push, pull, merge, rebase, and conflict resolution, all from the UI with no terminal.

> [!changed]
> The feature used to be called **Databricks Repos** and lived under `/Repos`. Today the name is **Git folders** and you can create them wherever you like, typically under `/Workspace/Users/<user>/`. The exam uses the wording "Git Folders (formerly Databricks Repos)"; in the API the term `repos` is still in use.

## Why it exists

A notebook saved in the workspace has an internal revision history, but it isn't versioned together with the rest of the project, it can't be reviewed in a pull request, and it never makes it into a CI/CD pipeline. A Git folder brings the standard developer workflow (feature branches, review, merge to `main`) into the workspace, and the same repository becomes the source of what a bundle deploys (see [[bundles-overview]]).

## How it works

### Providers and credentials

Supported providers: GitHub (Cloud and Enterprise), GitLab, Bitbucket (Cloud and Data Center), Azure DevOps, AWS CodeCommit, plus a generic option for other compatible servers. **HTTPS** only, no SSH.

Credentials are **per user** and are set under *Settings → Linked accounts*: a personal access token (PAT) or, for GitHub, the **Databricks GitHub App** with OAuth and automatic token renewal. For jobs and automation the docs recommend a service principal with its own Git credentials, so the job doesn't depend on one person's token.

### Cloning

*Create → Git folder*: paste the repository URL, pick the provider and the folder name. You can enable **sparse checkout** to clone only some subfolders of a monorepo.

### Operations from the UI

The Git dialog opens from the branch name next to the folder.

| Operation | What it does | CLI equivalent |
| --- | --- | --- |
| Create branch | new branch from the current one or from another | `git checkout -b` |
| Switch branch | changes branch; uncommitted changes carry over if they don't conflict | `git checkout` |
| Commit & Push | pick the files, write the message, send to the remote | `git commit && git push` |
| Pull | fetches the remote; on conflict opens the resolution editor | `git pull` |
| Merge | merges a branch into the current one and pushes if there are no conflicts | `git merge` |
| Rebase | replays the commits onto the chosen branch, then force-pushes | `git rebase` + `push --force` |
| Reset | aligns local and remote to a branch, discarding changes | `git reset --hard` |

**Conflicts**: the UI lists the conflicting files and for each one you can edit by hand, keep all current changes, take all incoming changes, or abort the operation.

**Pull requests**: you don't create them in Databricks. After the push, the dialog offers a link to open the PR on the provider (GitHub, GitLab…); review and merge happen there. After the merge, run *Pull* on the `main` Git folder.

Anyone who needs `git stash`, submodules, or interactive rebase can use the **Git CLI** from the web terminal or from a notebook.

### Git folder vs. workspace folder

| | Workspace folder | Git folder |
| --- | --- | --- |
| Versioning | per-notebook revision history | Git: commits, branches, tags |
| Notebook format | internal | source files (`.py`, `.sql`, `.ipynb`) |
| Notebook output | saved | excluded from commits by default |
| Who uses it in production | discouraged | jobs that read from Git or from a Git folder aligned with `main` |

### Limits and `.gitignore`

- The working branch is capped at **1 GB**; each Git operation gets 2 GB of memory and 4 GB of disk writes. A 5 GB clone fails; a repository that grows in small steps does not.
- Files over **10 MB** don't render in the UI.
- Databricks suggests staying under 20,000 assets per workspace and avoiding monorepos.
- `.gitignore` works as in Git: it only applies to files that aren't tracked yet. A file that is already committed doesn't disappear from history just because you add it later.

## Example

Typical flow for a feature on an ETL job:

```bash
# 1. In the "etl-sales" Git folder, from the Git dialog: Create branch "feature/dedup-customers"
# 2. Edit notebooks/clean_clienti.py and test it on serverless
# 3. Commit & Push with message "clean: dedup customers by email"
# 4. Click "Create pull request" → GitHub opens, open the PR against main
# 5. After the merge, in the production Git folder: switch to main → Pull
```

The same flow from the web terminal with the Git CLI:

```bash
git checkout -b feature/dedup-customers
git add notebooks/clean_clienti.py
git commit -m "clean: dedup customers by email"
git push -u origin feature/dedup-customers
```

## Common mistakes

- Working directly on `main` in your personal Git folder and pushing without a PR: you skip review and break the production Git folder on its next Pull.
- Expecting Databricks to create the pull request: it opens it on the provider, not inside the workspace.
- Committing notebook output or datasets: the branch goes past 1 GB and operations start to fail.
- Using a developer's personal token for a scheduled job: when that person leaves the team or the token expires, the job stops working. Use a service principal.
- Confusing notebook revisions (internal history) with Git commits: only the latter reach the repository.

> [!exam]
> The exam asks for the flow, not the commands: *create and switch branches, commit and push, open a PR* are done from the Git folder's Git dialog; the PR is completed on the provider. Remember the names: **Git folders (formerly Repos)**, credentials under *Linked accounts* (PAT or GitHub App), HTTPS only. Typical question: "a developer needs to test a change without touching production" → new branch in their own Git folder, PR, merge, Pull on the production Git folder.
