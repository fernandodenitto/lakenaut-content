---
id: semi-structured-data
title: "Semi-structured data: JSON, nested data, VARIANT"
area: data-ingestion
subarea: formats
level: intermediate
summary: JSON, struct, array and VARIANT represent nested data in a Delta table. Colon notation queries JSON, from_json builds structs, explode flattens arrays, VARIANT stores them binary.
prerequisites: [ingestion-patterns, delta-lake-overview]
related: [auto-loader, copy-into, dataframe-columns-rows, lakeflow-connect, unity-catalog-overview]
exams:
  - cert: de-associate
    domain: "Data Ingestion and Loading"
    objective: "Ingest semi-structured and unstructured data (for example, JSON and nested data) via Lakeflow Connect and other managed connectors into Unity-Catalog-governed Delta tables."
sources:
  - url: https://docs.databricks.com/aws/en/semi-structured/
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/semi-structured/json
    checked: 2026-09-09
  - url: https://docs.databricks.com/aws/en/semi-structured/variant
    checked: 2026-09-09
aliases: [json, nested data, variant, parse_json, from_json, explode, nested data, unstructured data]
updated: 2026-09-09
status: published
---

## What it is

**Semi-structured** data has a structure, but not a fixed one: an event JSON has nested fields, arrays of variable length, and keys that only show up sometimes. **Unstructured** data (PDFs, images, audio) has no tabular structure at all. Databricks handles them like this:

| Representation | Schema | Reading | Writing | When |
| --- | --- | --- | --- | --- |
| **JSON string** | none | slow (parses everything) | immediate | raw bronze, unknown schema |
| **VARIANT** | none, binary encoding | fast | immediate | flexible JSON in production |
| **Struct / array / map** | explicit | fastest, data skipping | needs pre-processing | silver and gold, known schema |
| **File in a volume** | none | via path | upload or copy | PDFs, images, documents |

## Why it exists

Modern sources (APIs, events, logs, SaaS connectors from [[lakeflow-connect]]) speak JSON. Forcing a schema at ingestion time breaks the pipeline at the first new field; never forcing one makes queries slow and fragile. Databricks' approach is gradual: in bronze you keep the JSON as-is (string or VARIANT, with `_rescued_data` from [[auto-loader]] catching what doesn't fit), and in silver you extract the fields you need into typed columns.

## How it works

### The `:` notation on JSON strings

A string column holding JSON is queried with `column:path`. The result is always a **string**, to be cast with `::`.

- Top-level field: `raw:owner`
- Nested field: `raw:store.bicycle.price::double`
- Array element: `raw:store.fruit[0]`
- All elements: `raw:store.book[*].isbn` returns an array
- Keys with spaces or special characters: `` raw:`zip code` `` or `raw:['fb:testid']`

Names in dot notation are case-insensitive; inside square brackets they're case-sensitive. A JSON `null` becomes SQL `NULL`.

### `from_json` and `schema_of_json`

To turn the string into a typed **struct** you need a schema: `from_json(raw, 'price DOUBLE, color STRING')`. If you don't know the schema, `schema_of_json(example)` infers it from a sample record; that's the typical way to write the schema once and then pin it down in code. `to_json` does the reverse.

### Struct, array, explode

A **struct** is read with dot notation (`dati.prezzo`), and `dati.*` expands it into columns. An **array** of structs is flattened with `explode(array)`, which produces one row per element; `explode_outer` keeps the row even when the array is empty. To operate on arrays without exploding them, there are higher-order functions (`transform`, `filter`). The rest of the DataFrame manipulation toolkit is covered in [[dataframe-columns-rows]].

### VARIANT

The **VARIANT** type (Runtime 15.3 and later) stores JSON with a binary encoding that beats plain strings on both reads and writes, with no schema required. Main functions:

| Function | What it does |
| --- | --- |
| `parse_json(str)` | string → VARIANT (`try_parse_json` returns NULL instead of failing) |
| `col:path` | the same notation as JSON strings, but typed: `raw:store.bicycle.price::double` |
| `variant_get(v, '$.path', 'type')` | extraction with an explicit cast (`try_variant_get` is tolerant) |
| `variant_explode(v)` | table-valued function: one row per key or element |
| `schema_of_variant(v)` | the value's inferred schema |
| `is_variant_null(v)` | distinguishes a JSON `null` from SQL `NULL` |

Limits: a VARIANT column can't be a clustering, partition, or Z-order key, and it doesn't support direct comparisons, `GROUP BY`, or `ORDER BY`. With the JSON reader's `singleVariantColumn` option (also available in Auto Loader), each record lands whole in a single VARIANT column.

### Unstructured files

PDFs, images, and documents are uploaded to a Unity Catalog **volume** (via UI upload, `dbutils.fs`, or the SDK) and read with `read_files` in `binaryFile` format, or with AI functions (`ai_parse_document`). The volume gives governance and lineage even to files that aren't tables.

## Example

A bronze table with a VARIANT column, then extraction into silver with an explode over line items.

```sql
CREATE TABLE shop.bronze.ordini_raw (
  ingested_at TIMESTAMP,
  payload VARIANT
);

INSERT INTO shop.bronze.ordini_raw
SELECT current_timestamp(), parse_json(value)
FROM read_files('/Volumes/shop/landing/orders/', format => 'text');

CREATE OR REPLACE TABLE shop.silver.righe_ordine AS
SELECT
  payload:order_id::string            AS order_id,
  payload:customer.email::string      AS email,
  item.value:sku::string              AS sku,
  item.value:qty::int                 AS qty,
  item.value:price::decimal(10,2)     AS price
FROM shop.bronze.ordini_raw,
  LATERAL variant_explode(payload:items) AS item;
```

```python
from pyspark.sql.functions import col, parse_json, explode, from_json, schema_of_json

raw = spark.read.text("/Volumes/shop/landing/orders/")

# Path A: VARIANT
bronze = raw.select(parse_json(col("value")).alias("payload"))
bronze.write.mode("append").saveAsTable("shop.bronze.ordini_raw")

# Path B: typed struct with a schema inferred from a sample
sample = raw.first()["value"]
schema = spark.range(1).select(schema_of_json(sample)).first()[0]

silver = (raw
  .select(from_json(col("value"), schema).alias("o"))
  .select("o.order_id", "o.customer.email", explode("o.items").alias("item"))
  .select("order_id", "email", "item.sku", "item.qty", "item.price"))
silver.write.mode("overwrite").saveAsTable("shop.silver.righe_ordine")
```

## Common mistakes

- Comparing or grouping directly on `raw:field` without a cast: you're working with strings, so `"10" < "9"`.
- Using `schema_of_json` on a single record in production: if that record doesn't have every field, the schema is incomplete and the missing fields silently become NULL.
- Running `explode` on an array that can be empty and losing rows: you need `explode_outer`.
- Keeping JSON strings all the way to gold: every query re-parses everything; switch to VARIANT or a struct.
- Storing PDFs and images on DBFS instead of in a volume: outside Unity Catalog governance.

> [!exam]
> The exam expects you to recognize the `column:nested.field[0]` notation for JSON strings and the `::` cast, the role of `from_json` (string → struct, needs a schema) versus `schema_of_json` (infers the schema), `explode` for arrays, and what **VARIANT** offers (`parse_json`, binary encoding, faster than a JSON string, no schema required). Know that Lakeflow Connect's managed connectors and Auto Loader land nested JSON directly into Delta tables governed by Unity Catalog, and that unstructured files belong in **volumes**.
