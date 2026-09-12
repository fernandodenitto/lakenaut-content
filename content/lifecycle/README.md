---
id: lifecycle-readme
title: How the end-of-support list works
---

One YAML file per thing that is ending, already ended, or deprecated. The site reads them into `/lifecycle/`, grouped by how soon they bite.

```yaml
id: dbr-14-3-lts                   # same as the file name
name: Databricks Runtime 14.3 LTS
kind: runtime                      # runtime | model | driver | api | feature | behaviour
status: ends                       # ends (future) | ended (past) | deprecated (no date, on the way out)
date: "2027-02-01"
area: compute
summary: One sentence on what happens.
action: One sentence on what to do about it.
url: https://docs.databricks.com/aws/en/...
concepts: [streaming-triggers]     # optional
checked: 2026-09-11
```

Rule: every entry needs a date and a source. A deprecation with no date is still worth recording, with the date it was announced.
