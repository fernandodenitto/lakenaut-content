---
id: ingestion-jdbc-rest
title: Ingesting from JDBC and REST APIs in notebooks
area: data-ingestion
subarea: custom
level: intermediate
summary: With no managed connector, a notebook reads a source over JDBC or REST, writes to a Unity Catalog table and runs as a job task. Credentials live in a secret scope.
prerequisites: [ingestion-patterns, jobs-overview]
related: [lakeflow-connect, jobs-task-dependencies, jobs-parameters, unity-catalog-overview, semi-structured-data]
exams:
  - cert: de-associate
    domain: "Data Ingestion and Loading"
    objective: "Use JDBC/ODBC or REST clients in notebooks to land data into cloud storage or directly into Unity-Catalog-governed tables, usually orchestrated and scheduled with Lakeflow Jobs."
sources:
  - url: https://docs.databricks.com/aws/en/connect/external-systems/jdbc
    checked: 2026-09-09
aliases: [jdbc, odbc, rest api ingestion, spark.read.jdbc, dbutils.secrets]
updated: 2026-09-09
status: published
---

## What it is

Not every source has a managed connector. A legacy database, an internal API, a niche SaaS service: in these cases the notebook becomes the connector. Two tools:

- **JDBC**: Spark reads a relational database with `spark.read.format("jdbc")`, distributing the read across the workers.
- **REST**: a Python library such as `requests` calls the API, and the result becomes a DataFrame via `spark.createDataFrame`.

In both cases the notebook writes the result to a Unity Catalog table (or to a volume used as a landing zone) and is scheduled as a task in a Lakeflow job (see [[jobs-overview]]).

## Why it exists

This is the least automated tier in the ingestion hierarchy (see [[ingestion-patterns]]): maximum flexibility, but you own credentials, incrementality, error handling, and retries. It makes sense when [[lakeflow-connect]] doesn't cover the source, when you need custom extraction logic, or as a stopgap. The docs themselves treat JDBC as a legacy approach: if **Lakehouse Federation** supports the database, registering it as a foreign catalog and querying it directly is the better option.

## How it works

### Secrets

Never put plaintext passwords in a notebook. Store them in a **secret scope** and read them with `dbutils.secrets.get(scope, key)`. The value is redacted in notebook output.

### JDBC reads

The essential options:

| Option | Role |
| --- | --- |
| `url` | connection string (`jdbc:postgresql://host:5432/db`) |
| `dbtable` | a table, or a parenthesized subquery with an alias |
| `query` | alternative to `dbtable`, a full query |
| `user`, `password` | credentials, from secrets |
| `partitionColumn`, `lowerBound`, `upperBound`, `numPartitions` | parallel reads |
| `fetchsize` | rows per round trip; raise the default to reduce latency |

Without partitioning, Spark uses **a single connection**: the whole table flows through one executor. With `partitionColumn` (numeric, date, or timestamp, evenly distributed) and the bounds, Spark opens `numPartitions` connections in parallel. Don't overdo it: beyond a few dozen partitions the source database starts to suffer.

You can also push the filter down to the source with a subquery in `dbtable`: `"(SELECT * FROM orders WHERE updated_at > '2026-09-01') AS o"`. That's the simplest way to make a JDBC read incremental: read the latest watermark from the target table and use it in the subquery.

In SQL the equivalent is a temporary view `USING JDBC OPTIONS (...)`.

### REST reads

`requests` runs on the driver, so it's not distributed: fine for paginated APIs with moderate volumes. The typical flow: loop over pages, accumulate records in a list, `spark.createDataFrame` with an explicit schema, write. For APIs that return nested JSON, store the raw payload as a string and parse it with the functions in [[semi-structured-data]].

### Writing and orchestration

The DataFrame is written with `.write.mode("append").saveAsTable("cat.schema.table")` or with a `MERGE` for upserts. The notebook becomes a **notebook task** in a job, with schedule, retries, timeout, and notifications; the watermark or extraction dates come in as [[jobs-parameters]].

## Example

Incremental extraction over JDBC from PostgreSQL, parallelized on `id`, with credentials from secrets:

```python
user = dbutils.secrets.get(scope="erp", key="pg_user")
password = dbutils.secrets.get(scope="erp", key="pg_password")

last_ts = spark.sql(
    "SELECT coalesce(max(updated_at), '1970-01-01') FROM erp.bronze.orders"
).first()[0]

orders = (spark.read.format("jdbc")
  .option("url", "jdbc:postgresql://erp-db.internal:5432/erp")
  .option("dbtable", f"(SELECT * FROM orders WHERE updated_at > '{last_ts}') AS o")
  .option("user", user)
  .option("password", password)
  .option("partitionColumn", "id")
  .option("lowerBound", 1)
  .option("upperBound", 5_000_000)
  .option("numPartitions", 8)
  .option("fetchsize", 10_000)
  .load())

orders.write.mode("append").saveAsTable("erp.bronze.orders")
```

The same database, read from SQL as a temporary view:

```sql
CREATE TEMPORARY VIEW ordini_pg
USING JDBC
OPTIONS (
  url 'jdbc:postgresql://erp-db.internal:5432/erp',
  dbtable 'orders',
  user secret('erp', 'pg_user'),
  password secret('erp', 'pg_password')
);

INSERT INTO erp.bronze.orders SELECT * FROM ordini_pg WHERE updated_at > '2026-09-01';
```

A paginated REST call written to Unity Catalog:

```python
import requests
from pyspark.sql.types import StructType, StructField, StringType, DoubleType

token = dbutils.secrets.get(scope="meteo", key="api_token")
schema = StructType([
    StructField("city", StringType()),
    StructField("temp_c", DoubleType()),
    StructField("observed_at", StringType()),
])

rows, page = [], 1
while True:
    r = requests.get("https://api.meteo.example/v1/observations",
                     headers={"Authorization": f"Bearer {token}"},
                     params={"page": page, "per_page": 500}, timeout=30)
    r.raise_for_status()
    data = r.json()
    rows += [(d["city"], d["temp_c"], d["observed_at"]) for d in data["items"]]
    if not data.get("next_page"):
        break
    page += 1

spark.createDataFrame(rows, schema).write.mode("append").saveAsTable("meteo.bronze.osservazioni")
```

The notebook runs hourly as a job task; if it fails, the task retry repeats the extraction.

## Common mistakes

- Passwords in code or in job parameters instead of a secret scope.
- JDBC reads without `partitionColumn`: a single connection, hours for large tables.
- `numPartitions` set to 200 "to go faster": the source database collapses.
- Calling a REST API inside a per-row UDF: thousands of calls, rate limit blown.
- Reinventing CDC by hand for SQL Server or Salesforce when a managed connector exists.
- Writing to DBFS or to a Hive table instead of Unity Catalog: you lose governance and lineage.

> [!exam]
> The exam treats JDBC and REST as the **fallback** when Lakeflow Connect doesn't cover the source. Remember: `spark.read.format("jdbc")` with `url`, `dbtable`, `user`, `password`; parallelism comes from `partitionColumn`, `lowerBound`, `upperBound`, `numPartitions`; credentials are read with `dbutils.secrets.get`; the destination is a Unity Catalog table; orchestration is a **notebook task** in a scheduled Lakeflow job. If the question mentions a database supported by Lakehouse Federation or by a managed connector, that is the better answer over JDBC.
