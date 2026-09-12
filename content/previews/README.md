---
id: previews-readme
title: How the preview radar works
---

One YAML file per feature that is **not** generally available. The site reads them into `/preview/`, kept apart from the concepts so nothing in preview reads like settled material.

```yaml
id: zerobus-default-storage        # same as the file name
name: Zerobus Ingest into default storage
label: public-preview              # public-preview | beta | private-preview
area: data-ingestion               # an id from content/areas/
summary: One sentence on what it does.
why: One sentence on why it is worth watching, or leave empty.
since: "2026-09"
url: https://docs.databricks.com/aws/en/...
concept: auto-loader               # optional, once we have written about it
checked: 2026-09-11
```

When a feature reaches general availability, delete its file here and set `maturity: ga` on the concept that covers it.
