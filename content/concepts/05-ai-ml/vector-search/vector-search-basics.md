---
id: vector-search-basics
title: Databricks AI Search (formerly Vector Search)
area: vector-search
level: intermediate
summary: AI Search (formerly Mosaic AI Vector Search) turns Delta tables into governed, queryable embedding indexes with hybrid keyword-vector search and filters.
prerequisites: [delta-lake-overview, unity-catalog-overview]
related: [rag-pipeline, semi-structured-data, privileges-grant-revoke]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/ai-search/create-ai-search
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/generative-ai/vector-search
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/sql/language-manual/functions/vector_search
    checked: 2026-09-10
aliases: [vector search, mosaic ai vector search, databricks vector search, ai search, databricks ai search, semantic search, embedding index]
updated: 2026-09-11
status: published
---

## What it is

**Databricks AI Search** (called Mosaic AI Vector Search until June 2026) is the service that stores embeddings and answers "find me the rows most similar to this vector" in milliseconds. It has two moving parts. An **endpoint** is the serving infrastructure: it scales automatically with data size and query traffic, and a single endpoint can host many indexes. An **index** is the searchable structure built on top of a table — the thing you actually query. Indexes are registered in [[unity-catalog-overview]] as three-level objects, right next to tables and volumes.

## Why it exists

Similarity search over millions of embeddings needs an approximate nearest-neighbor (ANN) engine, not a table scan. Standing up that engine yourself means picking an ANN library, sizing a separate store, and re-inventing access control for it. AI Search does the ANN part and, because indexes live in Unity Catalog, they inherit governance for free: the permission model, lineage, and discovery you already have for tables extend to embeddings without a second system to secure.

## How it works

### Delta Sync Index vs. Direct Vector Access Index

| | Delta Sync Index | Direct Vector Access Index |
| --- | --- | --- |
| Source | a Delta table with a primary key | no backing table required |
| Updates | tracked automatically from table changes | pushed manually through the REST/SDK API |
| Best for | pipelines that already produce a Delta table of chunks | vectors computed or fetched outside Databricks |
| Conversion | — | cannot be converted into a Delta Sync index later |

Most [[rag-pipeline]] setups use a Delta Sync index because the chunking step already lands its output in a table.

### Managed vs. self-managed embeddings

A Delta Sync index can compute embeddings for you: point it at a text column and an embedding model endpoint, and AI Search calls the model and stores the resulting vectors — this is the **managed embeddings** path. Alternatively you can pre-compute vectors yourself (any model, any dimensionality) and store them in a column of type `array<float>`; the index just indexes that column — this is **self-managed vectors**. Once a column is chosen, the choice is fixed for that index's lifetime.

### Hybrid search and filters

A query can run as pure vector similarity, pure keyword (BM25-style) matching, or **hybrid**, which blends both rankings — useful when the query mixes natural language with exact identifiers like a SKU or an error code that embeddings alone tend to blur. Any column carried into the index can also be used as a query-time **filter** (equality, range, IN-lists), so retrieval narrows to a tenant, a document type, or a date range before similarity scoring runs.

### Governance, sync modes, and cost

Because indexes are Unity Catalog objects, `GRANT SELECT` on the index is enough to let a principal query it — see [[privileges-grant-revoke]]. Row and column-level policies are not supported on indexes; use query filters as the application-level equivalent. Delta Sync indexes have two sync modes: **continuous**, which keeps the index within seconds of the table and costs the most to run, and **triggered**, which syncs when you ask it to, from a job or by hand. There is no scheduled mode: a triggered sync inside a scheduled job is how you get one, and it is usually the right answer for a table that changes a few times a day.

## Example

```python
# pip install databricks-ai-search
from databricks.ai_search.client import AISearchClient

client = AISearchClient()

client.create_delta_sync_index(
    endpoint_name="kb_endpoint",
    index_name="main.rag.docs_index",
    source_table_name="main.rag.docs_chunked",
    pipeline_type="TRIGGERED",
    primary_key="chunk_id",
    embedding_source_column="chunk_text",
    embedding_model_endpoint_name="databricks-gte-large-en",
)

index = client.get_index(index_name="main.rag.docs_index")
results = index.similarity_search(
    query_text="how do I reset a warehouse's auto-stop?",
    columns=["chunk_text", "source_url"],
    filters={"product": "SQL Warehouses"},
    num_results=5,
    query_type="HYBRID",
)
```

```sql
SELECT chunk_text, source_url
FROM vector_search(
  index => 'main.rag.docs_index',
  query_text => 'how do I reset a warehouse auto-stop?',
  query_type => 'HYBRID',
  num_results => 5
);
```

## Common mistakes

- Choosing **continuous** sync for a table that changes once a day. It holds compute open to wait for changes that are not coming; a triggered sync in the job that loads the table costs a fraction of it.
- Forgetting that a Direct Vector Access index has no automatic sync: stale vectors are a pipeline bug, not a platform bug.
- Applying filters only in application code after retrieval, instead of at query time — it wastes the `num_results` budget on rows that get discarded anyway.
- Mixing embedding models across a re-indexing: a managed-embeddings index is bound to the model it was created with.
- Reaching for the old `VectorSearchClient` from `databricks.vector_search`. The product is now AI Search, and the client is `AISearchClient` from `databricks-ai-search`.

> [!tip]
> If two identical-looking queries return different rankings, check `query_type` first — "ANN" and "HYBRID" combine relevance signals differently, and it is the most common reason a demo behaves differently from production.
