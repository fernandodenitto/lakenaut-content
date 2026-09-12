---
id: workspace-files-volumes
title: Workspace files and volumes
area: workspace
subarea: storage
level: beginner
summary: Workspace files live with your code under /Workspace, Unity Catalog volumes govern non-tabular files under /Volumes, and DBFS is the deprecated predecessor.
prerequisites: [platform-architecture, unity-catalog-overview]
related: [notebooks-basics, volumes-managed-vs-external, managed-vs-external-tables, semi-structured-data, git-folders]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/files/
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/volumes/
    checked: 2026-09-10
aliases: [dbfs, workspace files, unity catalog volumes, /Workspace, /Volumes, file system]
updated: 2026-09-12
status: published
---

## What it is

Four different places end up holding "files" (as opposed to tables) on Databricks, and it's easy to reach for the wrong one:

| Surface | Path pattern | Governed by |
| --- | --- | --- |
| Workspace files | `/Workspace/Users/<user>/...` | workspace permissions |
| Unity Catalog volumes | `/Volumes/<catalog>/<schema>/<volume>/...` | Unity Catalog ([[privileges-grant-revoke]]) |
| Cloud object storage | `s3://...`, `abfss://...` | cloud IAM / storage credentials |
| DBFS (legacy) | `/dbfs/...`, `dbfs:/...` | workspace-level, no catalog |

Workspace files and volumes are the two you should actually reach for today; DBFS is what you'll find in old notebooks and should migrate away from.

## Why it exists

Code and data have different lifecycles. A small `.py` helper or a config file belongs next to the notebook that uses it, versioned the same way, small and personal — that's a **workspace file**. A CSV a pipeline reads every night, a folder of model checkpoints, or images a team shares needs governance, scale, and a stable path that doesn't depend on any one user's home folder — that's a **volume**, a Unity Catalog object like a table or a schema. **DBFS** predates Unity Catalog: it was the only shared file surface before volumes existed, has no catalog-level access control, and Databricks now recommends against it for anything new (see [[unity-catalog-overview]]).

## How it works

### Workspace files

Anything under `/Workspace` — notebooks, `.py`/`.sql` source, `.whl`/`.jar` libraries, small config or data files — is a workspace file. Two practical rules:

- **Relative imports work like local development.** A `utils.py` saved in the same folder as a notebook can be imported with a plain `from utils import clean_columns`; Databricks resolves the import relative to the notebook's own directory, no `sys.path` juggling required.
- **Size cap: 500 MB per file**, hard. Uploads or downloads past that fail outright, which is Databricks' own signal that workspace files are for code and small assets, not datasets. A notebook itself is also capped at 10,000 cells and 512 widgets.

Upload through *Add → File* in the workspace browser, or `databricks workspace import` from the CLI (see [[cli-and-sdk]]).

### Unity Catalog volumes

A volume is a governed pointer to a directory in cloud storage, addressed the same way from Spark, Python, SQL, or a plain shell command: `/Volumes/<catalog>/<schema>/<volume>/<path>`.

A volume is either **managed**, with Databricks owning the storage and its lifecycle, or **external**, pointing at a path you already control. The difference decides what happens when somebody drops it, and [[volumes-managed-vs-external]] covers that, the retention window and the privileges in full.

Grants work exactly like on tables (`GRANT READ VOLUME ON VOLUME ... TO ...`), and there's no documented per-file size ceiling — a volume scales with the cloud storage behind it. Requirement: Databricks Runtime 13.3 LTS or above, and paths must always include the volume name (no shortcuts via `dbutils.fs` on the driver only).

### Choosing between them

| Need | Use |
| --- | --- |
| A helper module next to a notebook | Workspace file |
| A one-off small lookup file for a demo | Workspace file |
| Raw data landing zone for a pipeline | Volume |
| Files an external tool must also read | External volume |
| Model artifacts, checkpoints, images shared by a team | Volume |
| Anything currently under `/dbfs` | Migrate to a volume |

## Example

```python
# Workspace file: import a helper sitting next to this notebook
from utils import normalize_email

# Unity Catalog volume: read raw files landed by an upstream system
df = (
    spark.read.format("json")
    .load("/Volumes/main/landing/raw_events/2026/09/10/")
)

df.write.format("delta").mode("append").saveAsTable("main.bronze.events")
```

```bash
# Same volume path from a shell command or the CLI
ls /Volumes/main/landing/raw_events/2026/09/10/
databricks fs cp ./local_export.csv dbfs:/Volumes/main/landing/exports/
```

## Common mistakes

- Uploading a multi-GB dataset as a workspace file: it silently caps at 500 MB and fails, when a volume would have taken it without complaint.
- Writing a new pipeline against `/dbfs/mnt/...`: it works today but is the deprecated path Databricks is actively steering everyone away from — start new work on volumes.
- Forgetting the volume name in a path (`/Volumes/main/landing/` instead of `/Volumes/main/landing/raw_events/`): listing operations require the fully-qualified path down to the volume.
- Storing credentials or environment config as a plain workspace file instead of a secret — see [[secrets-management]].
- Assuming a workspace file is versioned like a volume object: it follows workspace permissions and notebook-style history, not Unity Catalog lineage or ACLs.

> [!tip]
> If you're not sure which to use, ask whether the file needs to outlive a single user's workspace folder or be governed like a table. If yes, it's a volume; if it's small, personal, and lives next to your code, it's a workspace file.
