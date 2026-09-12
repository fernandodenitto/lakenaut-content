---
id: foundations
title: "SQL & Python Foundations"
tag: prerequisites
level: beginner
hours: 25
order: 0
icon: braces
summary: "The SQL and PySpark you need before any other path: the Spark dialect, types, joins, windows, MERGE, and the DataFrame API as it differs from pandas."
certs: [de-associate]
stages:
  - name: "SQL on Databricks"
    concepts: [spark-sql-basics, sql-data-types, sql-joins-and-sets]
  - name: "SQL that does work"
    concepts: [sql-window-functions, sql-merge-and-dml, sql-scripting, sql-pipe-syntax, ai-functions-sql]
  - name: "Python and PySpark"
    concepts: [pyspark-vs-pandas, python-in-notebooks, dataframe-io]
  - name: "Transforming data"
    concepts: [dataframe-columns-rows, dataframe-joins-unions, dataframe-dedup-aggregations, udfs-and-alternatives]
---

Every other path assumes this one. If you already write SQL for Postgres or pandas for analysis, you still want the first stage: the dialect is close enough to be misleading, and the differences that matter (ANSI mode, `LEFT SEMI`, `QUALIFY`, `MERGE`, lazy evaluation) are exactly the ones that bite in production.

Work it in order and you will be able to read every code block on the rest of the site without stopping. Skip to [[lakehouse-foundations|Lakehouse Foundations]] if you want the platform picture first and are happy to come back for the syntax.
