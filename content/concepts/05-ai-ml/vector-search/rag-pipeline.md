---
id: rag-pipeline
title: Building a RAG pipeline
area: vector-search
level: advanced
summary: A RAG pipeline parses, chunks, embeds, indexes, retrieves, and generates — and its quality is decided mostly by the chunking step.
prerequisites: [vector-search-basics, semi-structured-data]
related: [agent-framework, agent-evaluation, gold-layer-objects]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/generative-ai/tutorials/ai-cookbook/
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/generative-ai/tutorials/ai-cookbook/quality-data-pipeline-rag
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/sql/language-manual/functions/ai_parse_document
    checked: 2026-09-10
aliases: [rag, retrieval augmented generation, rag chain, unstructured data pipeline]
updated: 2026-09-11
status: published
---

## What it is

**Retrieval-augmented generation (RAG)** is the pattern of fetching relevant material from your own data before asking a language model to answer, instead of relying only on what the model memorized during training. On Databricks that pipeline has six stages: **parse** the raw documents, **chunk** the parsed text, **embed** each chunk, **index** the vectors with [[vector-search-basics]], **retrieve** the closest chunks for a question, and **generate** an answer from them.

## Why it exists

A model's training data is frozen and generic; your PDFs, tickets, and internal wikis are neither. RAG lets an application answer from current, private, citable sources without retraining anything — you keep the model fixed and swap out what it's allowed to read.

## How it works

### Parse

Unstructured files (PDF, DOCX, PPTX, scanned images) are not text yet. The SQL function `ai_parse_document` reads the binary content of a file and returns a structured breakdown of the document: an ordered list of elements (paragraphs, tables, section headers, figures) with their type, extracted content, and a confidence score. Structured tables inside a PDF come back as their own elements rather than mixed into surrounding prose, which is what later lets a chunker keep a table intact.

### Chunk

Chunking splits parsed content into pieces small enough to embed meaningfully and to fit inside a model's context window alongside the question. **Fixed-size chunking** (cut every N tokens, with some overlap) is simple and fast but can slice a sentence, or an answer, in half. **Semantic chunking** groups content by topic boundaries instead of a fixed count, keeping a coherent idea in one chunk. This step, more than model choice, decides whether retrieval works: a chunk that mixes two unrelated topics embeds into a vector that resembles neither well, and a chunk that is too large drowns the relevant sentence in noise. Overlap between consecutive chunks reduces the chance that a fact gets stranded exactly at a cut point.

### Embed and index

Each chunk becomes a vector, either through AI Search's managed embeddings or a self-managed model — see [[vector-search-basics]] for the tradeoff. The vectors land in an index that can be queried by similarity, keyword, or both.

### Retrieve and generate

At query time the user's question is embedded (or matched by keyword) and the index returns the top-K nearest chunks. Those chunks, plus the question, are assembled into a prompt and sent to an LLM to produce the final answer.

### Grounding and citations

"Grounding" means the answer is traceable back to specific retrieved chunks rather than invented. Carrying a source identifier (document URL, page number) alongside each chunk through retrieval into the prompt lets the generation step cite what it used — and lets you check, chunk by chunk, whether the citation actually supports the sentence it's attached to.

### Evaluating retrieval separately from generation

A RAG answer can be wrong for two unrelated reasons: the retriever fetched the wrong chunks, or the generator misused correct chunks. Measuring them together hides which one to fix. Retrieval is scored with precision/recall-style metrics against a labeled set of "which chunks should this question find" — independent of any LLM call. Generation is scored afterward, given that the right chunks were retrieved, on correctness and groundedness (see [[agent-evaluation]]).

### When RAG is the wrong tool

RAG answers questions that need a handful of specific passages. It is a poor fit when the task needs to reason over an entire dataset (aggregate a number across every row — that's a SQL job, not retrieval), when the answer requires multi-step lookups across many documents rather than a single relevant snippet, or when the corpus is small enough to fit whole in the model's context window, making retrieval overhead unnecessary.

## Example

```python
from databricks.vector_search.client import VectorSearchClient

parsed = spark.sql("""
  SELECT path, ai_parse_document(content) AS doc
  FROM READ_FILES('/Volumes/main/rag/raw_pdfs', format => 'binaryFile')
""")

chunks = (parsed
    .selectExpr("path", "explode(doc:document:elements) AS el")
    .selectExpr("path", "el:content::string AS chunk_text")
)
chunks.write.mode("overwrite").saveAsTable("main.rag.docs_chunked")

index = VectorSearchClient().get_index("kb_endpoint", "main.rag.docs_index")
hits = index.similarity_search(
    query_text="what is the auto-stop default for a SQL warehouse?",
    columns=["chunk_text", "path"],
    num_results=5,
)
```

## Common mistakes

- Tuning the LLM prompt to fix a bad answer when the real bug is retrieval returning the wrong chunks.
- Using one fixed chunk size for every document type instead of adapting it to how dense the source is.
- Dropping the source path/page during chunking, making citations and later debugging impossible.
- Reaching for RAG to answer "how many rows total" questions that a warehouse query would answer exactly.

> [!tip]
> When an answer looks wrong, retrieve the chunks first and read them yourself before touching the prompt — most quality bugs in a RAG pipeline live in parsing or chunking, not in the model.
