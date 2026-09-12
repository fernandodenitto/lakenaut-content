---
id: kafka-streaming
title: Reading and writing Apache Kafka
area: streaming
level: intermediate
summary: "The kafka format as a Structured Streaming source and sink: record schema, offsets, checkpoints, authentication, and the end-to-end Kafka to Delta pattern."
prerequisites: [structured-streaming-basics]
related: [structured-streaming-basics, streaming-triggers, foreachbatch, ingestion-patterns, semi-structured-data]
exams:
  - cert: de-associate
    domain: "Data Ingestion and Loading"
    objective: "Ingest streaming data through standard connectors such as Apache Kafka as part of batch, streaming, and incremental ingestion patterns."
sources:
  - url: https://docs.databricks.com/aws/en/connect/streaming/kafka
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/connect/streaming/kafka/options
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/structured-streaming/triggers
    checked: 2026-09-11
aliases: [kafka, read_kafka, startingOffsets, maxOffsetsPerTrigger, MSK, Event Hubs, Pulsar, Kinesis, Pub/Sub]
updated: 2026-09-11
status: published
maturity: ga
---

## What it is

Kafka is reachable from Structured Streaming through the `kafka` format, both as a source (`spark.readStream.format("kafka")`) and as a sink (`writeStream.format("kafka")`). The same format works in batch mode with `spark.read` and `spark.write`, which is how you replay a bounded offset range. In SQL, Databricks Runtime 13.3 LTS and above offers the `read_kafka` table-valued function, but streaming SQL only runs inside a Lakeflow pipeline or a Databricks SQL streaming table.

Nothing about the micro-batch model changes: Kafka is one more source feeding the loop described in [[structured-streaming-basics]], and [[streaming-triggers]] still decides the cadence.

## Why it exists

Most operational data is already on a topic before anybody asks for it in the lakehouse, and the alternative is a bridge process that dumps Kafka to files so [[auto-loader]] can pick them up. That adds a hop, a format decision and a second thing to monitor.

The more interesting part is who owns the offsets. A normal Kafka consumer commits its position back to the broker under a consumer group. Structured Streaming does not: it records offsets in its own **checkpoint** and treats the consumer group as an implementation detail. Progress therefore belongs to the query, restarts are exact, and two queries reading the same topic never fight over a shared position.

## How it works

### The record schema

Every row the reader produces has the same seven columns, whatever is in the topic:

| Column | Type |
| --- | --- |
| `key` | binary |
| `value` | binary |
| `topic` | string |
| `partition` | int |
| `offset` | long |
| `timestamp` | timestamp |
| `timestampType` | int |

Key and value always come back as byte arrays, deserialised with `ByteArrayDeserializer`. Parsing them is your job: `cast("string")` then `from_json` for JSON, or `from_avro` and `from_protobuf` for the binary formats, optionally against a schema registry. See [[semi-structured-data]] for the JSON side of that.

### Choosing topics

Exactly one of three options, never two:

| Option | Value |
| --- | --- |
| `subscribe` | a comma-separated list of topic names |
| `subscribePattern` | a Java regex, for example `orders.*` |
| `assign` | a JSON string naming partitions, `{"topicA":[0,1]}` |

### Where to start, and how much per batch

`startingOffsets` defaults to `latest` for streaming reads and `earliest` for batch reads. It accepts `earliest`, `latest`, or a JSON map where `-1` means latest and `-2` means earliest: `{"topicA":{"0":23,"1":-2}}`. The trap is in the small print: **it only applies when a new query starts**. A resumed query always takes its position from the checkpoint, so editing `startingOffsets` on a running pipeline does nothing. Partitions that appear later start at the earliest available offset regardless.

For time rather than position there are `startingTimestamp` (milliseconds, all partitions) and `startingOffsetsByTimestamp` (per partition); when no offset matches a timestamp, `startingOffsetsByTimestampStrategy` decides between `error` (the default) and `latest`.

Batch size is bounded from the source side:

| Option | Default | Effect |
| --- | --- | --- |
| `maxOffsetsPerTrigger` | none | ceiling on offsets per trigger, spread proportionally across partitions |
| `minOffsetsPerTrigger` | none | wait until this many offsets have accumulated before running a batch |
| `maxTriggerDelay` | `15m` | run anyway once this much time has passed waiting for `minOffsetsPerTrigger` |
| `minPartitions` | none | split large Kafka partitions across more Spark partitions |
| `maxRecordsPerPartition` | none | cap records per Spark partition; with `minPartitions`, whichever yields more partitions wins |

Without `minPartitions`, parallelism is fixed at one Spark partition per topic-partition, which is why an eight-partition topic will not use a large cluster.

`failOnDataLoss` defaults to `true`: the query fails if data may have been lost, for example after a topic is deleted or offsets are truncated by retention. Databricks estimates conservatively, so false alarms happen. Turning it off means agreeing to silent gaps.

### Authentication

The recommended route for cloud-managed Kafka (AWS MSK, Azure Event Hubs, Google Cloud Managed Kafka) is a Unity Catalog **service credential**, available in Databricks Runtime 16.1 and above: set `databricks.serviceCredential` to its name and drop `kafka.sasl.mechanism`, `kafka.sasl.jaas.config` and `kafka.security.protocol` entirely. Governance then lives in [[unity-catalog-overview]] rather than in a cluster configuration.

Without a service credential you pass Kafka client properties through with the `kafka.` prefix: `kafka.security.protocol` (`SASL_SSL`, `SSL`, `PLAINTEXT`), `kafka.sasl.mechanism` (`PLAIN`, `SCRAM-SHA-256`, `SCRAM-SHA-512`, `OAUTHBEARER`, `AWS_MSK_IAM`), `kafka.sasl.jaas.config`, and the truststore and keystore paths and passwords. Those passwords belong in [[secrets-management]], never inline.

### Writing back

The writer needs a `value` column (`STRING` or `BINARY`); `key`, `headers`, `topic` and `partition` are optional, and the `topic` writer option overrides any `topic` column in the data. Databricks Runtime 13.3 LTS and above ships a kafka-clients version with idempotent writes on by default, which breaks against brokers at Kafka 2.8.0 or below that have ACLs but no `IDEMPOTENT_WRITE`: the write fails with `Cannot execute transactional method because we are in an error state`. Either upgrade the broker or set `kafka.enable.idempotence` to `false`.

### Watching the lag

The source reports `avgOffsetsBehindLatest`, `maxOffsetsBehindLatest` and `minOffsetsBehindLatest` per query, plus `estimatedTotalBytesBehindLatest`, estimated over a window set by `bytesEstimateWindowLength` (default `300s`). In Databricks Runtime 17.1 and above the latest offsets are fetched *after* each micro-batch, so a busy topic shows a small permanent backlog. That is normal and not a sign the query is falling behind.

### The sibling connectors

The same shape covers the rest: Kinesis (`format("kinesis")`, `streamName` or `streamARN`, and `consumerMode` set to `efo` for enhanced fan-out with 2 MB/s per shard on Databricks Runtime 11.3 LTS and above), Google Pub/Sub, Azure Event Hubs through the Kafka connector, and Apache Pulsar (`format("pulsar")` on Databricks Runtime 14.1 and above, with `service.url` and one of `topic`, `topics` or `topicsPattern`). All of them hand you a binary payload, keep their position in the checkpoint, and support `failOnDataLoss`. Learn Kafka and the others are a table lookup.

## Example: Kafka to Delta, end to end

Parse a JSON payload and land it in a bronze table as an incremental batch:

```sql
CREATE OR REFRESH STREAMING TABLE shop.bronze.events AS
SELECT
  key::string:user_id AS user_id,
  value::string:event_type AS event_type,
  to_timestamp(value::string:event_ts) AS event_ts
FROM STREAM read_kafka(
  bootstrapServers => 'broker.internal:9092',
  subscribe => 'shop-events',
  serviceCredential => 'kafka_msk_cred'
);
```

```python
from pyspark.sql.functions import col, from_json

value_schema = "event_type STRING, event_ts TIMESTAMP"
checkpoint = "/Volumes/shop/streaming/_checkpoints/events_bronze"

kafka_options = {
    "kafka.bootstrap.servers": "broker.internal:9092",
    "subscribe": "shop-events",
    "databricks.serviceCredential": "kafka_msk_cred",
    "startingOffsets": "earliest",    # only honoured on the first run
    "maxOffsetsPerTrigger": "500000", # bound the catch-up batches
}

(spark.readStream.format("kafka").options(**kafka_options).load()
  .select(
      col("key").cast("string").alias("user_id"),
      from_json(col("value").cast("string"), value_schema).alias("v"),
      col("timestamp").alias("kafka_ts"),
      col("offset"))
  .select("user_id", "v.*", "kafka_ts", "offset")
  .writeStream
  .option("checkpointLocation", checkpoint)
  .trigger(availableNow=True)
  .toTable("shop.bronze.events"))
```

Keeping `offset` and `kafka_ts` in bronze costs almost nothing and pays for itself the first time somebody asks whether a record was ever consumed.

## Common mistakes

- **Editing `startingOffsets` to reprocess.** A resumed query reads its position from the checkpoint and ignores the option. Replay means a fresh checkpoint, or a batch read with `startingOffsets` and `endingOffsets`.
- **Setting `kafka.group.id` because Kafka consumers usually have one.** Queries that share a group id interfere with each other and can each read only part of the data. Leave the auto-generated id (prefix `spark-kafka-source` for streaming, `spark-kafka-relation` for batch) alone.
- **Running an eight-partition topic on a large cluster and wondering why it is slow.** Parallelism follows topic partitions until you set `minPartitions` or `maxRecordsPerPartition`.
- **Starting from `earliest` on a topic with a week of retention, with no `maxOffsetsPerTrigger`.** The first batch tries to swallow the whole topic.
- **Setting `failOnDataLoss` to `false` to silence an alert.** It is telling you retention expired before the query caught up. Fix the lag, or accept documented gaps.
- **Forgetting to parse `value`.** It is binary. A stream that lands one binary column per event and calls it bronze is a stream nobody can query.

> [!exam]
> Know the seven columns of the Kafka row and that `key` and `value` are `binary` and need an explicit cast plus `from_json`. Know that exactly one of `subscribe`, `subscribePattern` and `assign` is allowed, that `startingOffsets` defaults to `latest` for streaming and `earliest` for batch and applies only to a new query, and that offsets live in the Structured Streaming checkpoint rather than in a Kafka consumer group. `maxOffsetsPerTrigger` bounds the batch; the trigger decides when it runs. For incremental ingestion from Kafka, the expected answer is `Trigger.AvailableNow` in a scheduled job.
