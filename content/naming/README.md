---
id: naming-readme
title: How rename tracking works
---

One YAML file per product rename, named `<old>-to-<new>.yml`. The site reads them into `/naming/` and shows a one-line trail on every concept the rename touches.

```yaml
id: vector-search-to-ai-search     # same as the file name
current: AI Search
trail:                             # oldest first
  - name: Mosaic AI Vector Search
    until: "2026-06"
    note: Optional, one line.
  - name: AI Search
changed: "2026-06-01"              # when the current name took over
area: vector-search
concepts: [vector-search-basics, rag-pipeline]
exam_note: Which exam guides still use the old name.
source: https://docs.databricks.com/aws/en/release-notes/product/2026/june
```

Rule: never delete an old name. The exams and half the internet still use it, and that is the whole point of this folder.
