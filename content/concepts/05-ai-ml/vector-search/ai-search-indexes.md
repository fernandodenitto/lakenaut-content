---
id: ai-search-indexes
title: AI Search index types and sync modes
area: vector-search
level: advanced
summary: The four AI Search index options, continuous against triggered sync, and standard against storage-optimized endpoints, with the choices you cannot undo later.
prerequisites: [vector-search-basics, delta-lake-overview]
related: [rag-pipeline, change-data-feed, unity-catalog-overview, foundation-model-apis]
exams:
  - cert: genai-engineer-associate
    domain: "Assembling and Deploying Applications"
    objective: "Configure vector search for a particular solution based on number of embeddings, update frequency, latency, and cost requirements."
sources:
  - url: https://docs.databricks.com/aws/en/ai-search/ai-search
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/ai-search/create-ai-search
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/ai-search/query-ai-search
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/supported-models
    checked: 2026-09-11
aliases: [delta sync index, direct vector access, full-text index, storage-optimized endpoint, pipeline_type, vector search index types, continuous sync, triggered sync]
updated: 2026-09-11
status: published
maturity: ga
---

## What it is

[[vector-search-basics|Databricks AI Search]] gives you one kind of object to query, an **index**, but four ways to build one. Two questions decide which you get: who computes the embeddings, and who keeps the index in step with the data underneath it. A third question, which **endpoint** the index sits on, decides how large it can grow and how fresh it can be.

These are not interchangeable settings you tune later. Two of the three are fixed at creation time, so the choice is worth making deliberately.

## Why it exists

A knowledge base of 200,000 support articles that changes hourly, a catalogue of a billion product vectors rebuilt nightly, and a set of embeddings produced by a model that only runs on your own GPU cluster are three different engineering problems. A single index design would be wrong for at least two of them: continuous streaming is wasted money on the nightly rebuild, and an index that insists on computing embeddings for you is useless when the embeddings arrive from elsewhere.

So AI Search splits the decision. The parts that can be automated (calling an embedding model, following table changes) are opt-in rather than mandatory, and the storage tier is a separate axis from the sync behaviour.

## How it works

### The four index options

| Option | Where embeddings come from | How it stays current |
| --- | --- | --- |
| **Delta Sync, Databricks-computed embeddings** | you name a text column and an embedding model endpoint; Databricks calls the model and can optionally write the vectors back to a Unity Catalog table | automatic, from changes to the source table |
| **Delta Sync, self-managed embeddings** | you compute the vectors yourself and store them in a column of the source table | automatic, from changes to the source table |
| **Direct Vector Access** | you push vectors in through the REST API or the SDK | nothing automatic; every update is yours to make |
| **Full-text index** (Beta) | none at all: no embedding column, BM25 keyword scoring | automatic, triggered sync only |

The full-text index is created by passing `index_subtype="FULL_TEXT"` to `create_delta_sync_index()` with no embedding column. It is worth separating two things the names blur together: creating a **dedicated** full-text index is part of the **Vector Search: Full-Text Search** beta and works only on storage-optimized endpoints with triggered sync, while running a keyword query with `query_type="FULL_TEXT"` against an existing index works on both endpoint types.

### Continuous or triggered

`pipeline_type` takes two values.

- `"CONTINUOUS"` keeps the index within seconds of the table. It costs more, because a compute cluster is held to run the streaming sync pipeline.
- `"TRIGGERED"` syncs when you ask: `index.sync()` from the SDK, **Sync now** in the UI, or a REST call. Put that call in a [[jobs-overview|Lakeflow job]] at the end of the pipeline that writes the chunks and the index is exactly as fresh as the data, with nothing running in between.

Both are incremental on a standard endpoint: only rows changed since the last sync are processed. The difference is who decides when, not how much work gets done.

### Standard or storage-optimized endpoints

| | Standard | Storage-optimized |
| --- | --- | --- |
| Capacity | 320 million vectors at dimension 768 | over one billion vectors at dimension 768 |
| Indexing speed | baseline | 10 to 20 times faster |
| Query latency | baseline | roughly 250 ms higher |
| Sync modes | continuous and triggered | **triggered only** |
| Constraints | `target_qps` available for high-throughput workloads | embedding dimension must divide by 16; `columns_to_sync` not supported |

`endpoint_type` is `"STANDARD"` or `"STORAGE_OPTIMIZED"` at `create_endpoint()` time. The dimension rule quietly rules out some embedding models, so check it before you commit: `databricks-gte-large-en` produces 1024 dimensions, which is fine.

### Change Data Feed

A Delta Sync index on a **standard** endpoint requires [[change-data-feed|Change Data Feed]] on the source table. That is how the index learns which rows changed instead of rescanning the table, and it is the single most common reason index creation fails on a table somebody else built. Turn it on before creating the index, not after: CDF only records changes made from the moment it is enabled.

### Limits worth knowing before you design

500 endpoints per workspace, 50 indexes per endpoint, embedding dimension up to 4096, at most 10,000 results from an ANN query, at most 200 from a hybrid query, and 100 KB per row. The 200-result ceiling on hybrid search is the one that surprises people building a re-ranking stage on top of a wide first-pass retrieval.

### What you cannot undo

**You cannot convert an index between embedding options.** In the documentation's words, a self-managed embedding index cannot become a Databricks-managed one: if you change your mind you create a new index and recompute every embedding. The same applies in reverse, and a Direct Vector Access index never grows an automatic sync. Migrating a large index means a full rebuild and a cutover, which is a project rather than an afternoon.

## Example: a triggered Delta Sync index with computed embeddings

Enable Change Data Feed on the chunk table first.

```sql
ALTER TABLE main.rag.docs_chunked
  SET TBLPROPERTIES (delta.enableChangeDataFeed = true);
```

```python
%pip install databricks-ai-search
dbutils.library.restartPython()

from databricks.ai_search.client import AISearchClient

client = AISearchClient()

client.create_endpoint(name="kb_endpoint", endpoint_type="STANDARD")

index = client.create_delta_sync_index(
    endpoint_name="kb_endpoint",
    source_table_name="main.rag.docs_chunked",
    index_name="main.rag.docs_index",
    pipeline_type="TRIGGERED",
    primary_key="chunk_id",
    embedding_source_column="chunk_text",
    embedding_model_endpoint_name="databricks-gte-large-en",
    columns_to_sync=["chunk_id", "chunk_text", "source_url", "product"],
)

index.sync()  # run this at the end of the job that refreshes docs_chunked
```

A dedicated full-text index over the same chunks, on a storage-optimized endpoint, with no embedding model in sight:

```python
client.create_endpoint(name="kb_bm25", endpoint_type="STORAGE_OPTIMIZED")

client.create_delta_sync_index(
    endpoint_name="kb_bm25",
    source_table_name="main.rag.docs_chunked",
    index_name="main.rag.docs_keyword_index",
    pipeline_type="TRIGGERED",
    primary_key="chunk_id",
    columns_to_sync=["chunk_id", "chunk_text", "source_url"],
    index_subtype="FULL_TEXT",
)
```

That second block is Beta as of September 2026. Read it to know the option exists; if you need keyword matching on a production index today, query an existing index with `query_type="FULL_TEXT"` instead.

## Common mistakes

- **Creating the index before enabling Change Data Feed.** On a standard endpoint the Delta Sync index needs it, and enabling CDF afterwards does not backfill the change history.
- **Choosing `"CONTINUOUS"` for a table a nightly job writes.** You pay for a streaming cluster to watch a table that changes once a day. Triggered sync called from the same job gives identical freshness for a fraction of the cost.
- **Picking a storage-optimized endpoint for its capacity and then asking for continuous sync.** It is not supported, and neither is `columns_to_sync`, so the whole index design has to change.
- **Choosing self-managed embeddings to keep options open.** It does the opposite: that index can never become a Databricks-managed one.
- **Designing a re-ranking stage that pulls 500 hybrid results.** Hybrid search caps at 200. Use ANN, which allows up to 10,000, if you genuinely need a wide first pass.
- **Ignoring the dimension-divisible-by-16 rule** until an index creation fails on a storage-optimized endpoint with an otherwise sensible embedding model.

> [!exam]
> The Generative AI Engineer Associate guide asks you to configure search "based on number of embeddings, update frequency, latency, and cost requirements", which is exactly this page. Expect a scenario: a table refreshed nightly plus a cost constraint means `pipeline_type="TRIGGERED"`, seconds-fresh retrieval means `"CONTINUOUS"`, and a billion vectors means a storage-optimized endpoint and therefore triggered sync whether you like it or not. Remember that the guide still calls the product Vector Search, that Delta Sync on a standard endpoint needs Change Data Feed, and that you cannot switch an index between Databricks-computed and self-managed embeddings.
