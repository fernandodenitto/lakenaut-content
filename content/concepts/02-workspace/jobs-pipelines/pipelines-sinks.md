---
id: pipelines-sinks
title: "Sinks: writing out of a pipeline"
area: jobs-pipelines
subarea: pipelines
level: advanced
summary: A sink lets a pipeline flow write somewhere that is not a pipeline-managed table, such as a Kafka topic or an external Delta table. Declared with create_sink, fed by an append flow, Python only.
prerequisites: [pipelines-overview, structured-streaming-basics]
related: [foreachbatch, kafka-streaming, pipelines-sql-vs-python, pipelines-event-log]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/ldp/concepts/sinks
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/ldp/ldp-sinks
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/ldp/developer/ldp-python-ref-sink
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/ldp/developer/ldp-python-ref-foreach-batch-sink
    checked: 2026-09-12
aliases: [create_sink, sink, foreach_batch_sink, kafka sink, delta sink, reverse etl, pipeline sink]
updated: 2026-09-12
status: published
---

## What it is

A **sink** is an output target for a pipeline flow that is not a dataset the pipeline manages. By default every flow in a Lakeflow pipeline (see [[pipelines-overview]]) writes to a streaming table or a materialized view in Unity Catalog. A sink sends the same stream of records somewhere else: a Kafka topic, an Azure Event Hubs namespace, a Delta table the pipeline does not own, or anything you can reach from Python.

There are two APIs, `create_sink()` and `@dp.foreach_batch_sink()`, and both work the same way in outline: you declare a **named** sink, then you reference that name as the `target` of an `append_flow`. Both are Python only. There is no SQL equivalent, and this is one of the few places where the two pipeline interfaces are genuinely not interchangeable (see [[pipelines-sql-vs-python]]).

## Why it exists

Pipelines are opinionated: declare datasets, let the engine work out the graph and keep the tables up to date. That falls apart the moment the consumer of your data is not a table. A fraud service subscribes to a topic, not to a Delta table. A downstream team owns an external Delta table you are supposed to append to rather than replace. A partner wants Parquet in their own bucket in their own layout.

Before sinks, the way out was to break the pipeline in two: land the result in a streaming table, then run a separate Structured Streaming job with [[foreachbatch|foreachBatch]] to push it onward. That means a second checkpoint, a second schedule, a second thing to monitor, and a gap between the two where records sit. A sink keeps the outbound write inside the same pipeline update, with the same trigger and the same run history.

## How it works

### The sink types

| Sink type             | `format`                             | Destination                                                                            |
| --------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| Delta table sink      | `delta`                              | a Unity Catalog managed or external Delta table, addressed by `tableName` or by `path` |
| Apache Kafka sink     | `kafka`                              | a Kafka topic, using the connector built into the pipeline runtime                     |
| Azure Event Hubs sink | `kafka`                              | Event Hubs through its Kafka interface, with the same options                          |
| Python custom sink    | the name of a registered data source | anything, via a custom data source registered with `spark.dataSource.register`         |
| ForEachBatch sink     | (no format)                          | arbitrary Python logic per micro-batch, declared with `@dp.foreach_batch_sink()`       |

### Declaring a sink

```python
dp.create_sink(name=<sink_name>, format=<format>, options=<options>)
```

`name` is required and must be unique across every source file in the pipeline. `format` is required and is `kafka` or `delta` (or the name of a registered custom data source). `options` is a `{"key": "value"}` dictionary, and it accepts all the Databricks Runtime options the underlying Kafka or Delta writer supports, so the Kafka options are the same ones you would pass to a Structured Streaming Kafka writer (see [[kafka-streaming]]).

Delta table names must be fully qualified: three levels for Unity Catalog, `<schema>.<table>` for a Hive metastore managed table.

### Feeding it with an append flow

```python
@dp.append_flow(name="silver_to_archive", target="archive")
def silver_to_archive():
    return spark.readStream.table("main.silver.orders")
```

The flow must return a streaming DataFrame. Append flows are what write to a sink; the `create_sink()` reference also allows an update flow. Every other flow type is rejected, `create_auto_cdc_flow()` included, so a sink cannot receive CDC output directly (see [[pipelines-auto-cdc]]). You have to land the CDC result in a streaming table first and read that.

For Kafka and Event Hubs the DataFrame must produce a `value` column; `key`, `partition`, `headers` and `topic` are optional.

### Limitations that matter

- Python only. SQL is not supported.
- Streaming queries only. A batch query cannot feed a sink.
- **Expectations are not supported on sinks.** Put your [[pipelines-expectations|expectations]] on the table upstream of the sink.
- A **full refresh does not clear the sink**. Reprocessed records are appended and the existing data is left alone, so a full refresh of the pipeline duplicates everything the sink has already emitted.

## Example: a silver table plus a Kafka topic and an archive table

```python
from pyspark import pipelines as dp
from pyspark.sql import functions as F

@dp.table(name="silver_transactions")
@dp.expect_or_drop("has_amount", "amount IS NOT NULL")
def silver_transactions():
    return (spark.readStream.table("main.bronze.transactions_raw")
            .withColumn("amount", F.col("amount").cast("decimal(12,2)")))

# The credential is a Unity Catalog service credential, not an inline secret.
dp.create_sink(
    name="fraud_topic",
    format="kafka",
    options={
        "databricks.serviceCredential": "kafka-prod",
        "kafka.bootstrap.servers": "broker.example.com:9093",
        "topic": "transactions.suspect",
    },
)

@dp.append_flow(name="suspect_to_kafka", target="fraud_topic")
def suspect_to_kafka():
    return (spark.readStream.table("silver_transactions")
            .where("amount > 10000")
            .selectExpr(
                "cast(transaction_id as string) AS key",
                "to_json(struct(transaction_id, customer_id, amount, event_ts)) AS value"))

dp.create_sink(
    name="archive",
    format="delta",
    options={"tableName": "main.archive.transactions_archive"},
)

@dp.append_flow(name="silver_to_archive", target="archive")
def silver_to_archive():
    return spark.readStream.table("silver_transactions")
```

`main.archive.transactions_archive` is an ordinary table that the pipeline appends to. It is not a pipeline dataset, so the pipeline never rewrites or prunes it, and a full refresh of `silver_transactions` will append the whole history to it a second time.

When the destination needs logic no writer offers, the ForEachBatch sink takes over. The handler takes a DataFrame and a `batch_id`, and a `batch_id` of `0` marks either the start of the stream or the start of a full refresh, which is your hook for making the write idempotent:

```python
@dp.foreach_batch_sink(name="crm_upsert")
def crm_upsert(df, batch_id):
    if batch_id == 0:
        df.sparkSession.sql("TRUNCATE TABLE main.crm.customer_scores")
    df.createOrReplaceTempView("updates")
    df.sparkSession.sql("""
        MERGE INTO main.crm.customer_scores t
        USING updates s ON t.customer_id = s.customer_id
        WHEN MATCHED THEN UPDATE SET * WHEN NOT MATCHED THEN INSERT *
    """)

@dp.append_flow(name="scores_to_crm", target="crm_upsert")
def scores_to_crm():
    return spark.readStream.table("silver_transactions")
```

## Common mistakes

- **Looking for the SQL syntax.** There is none. If a pipeline needs a sink, that part of the pipeline is Python. You can keep the rest in SQL, because a pipeline mixes both languages as long as each language is in its own source file.
- **Putting an expectation on the sink.** It is silently unsupported. Validate on the streaming table that feeds the flow.
- **Running a full refresh and wondering where the duplicates came from.** The sink keeps everything it has ever been sent. Either make the destination idempotent, or accept that full refresh is not an operation you run casually on a pipeline with sinks.
- **Pointing `create_auto_cdc_flow()` at a sink.** Not supported. Land the CDC output in a streaming table and add an append flow from there.
- **Forgetting the `value` column.** A Kafka or Event Hubs sink needs it. Serialise with `to_json(struct(...))` and cast the key to `string`.
- **Treating a Delta sink as the pipeline's own table.** It is an outbound write. The pipeline does not manage that table's lifecycle, and nothing about the sink makes the destination part of the pipeline's declarative graph.
