---
id: generative-ai
title: "Generative AI"
tag: "LLMs & agents"
level: advanced
hours: 45
order: 7
icon: bot
summary: "Foundation models on Databricks, vector search for retrieval, agents built with Agent Bricks and the Agent Framework, and how to evaluate them."
certs: []
stages:
  - name: "Foundations"
    concepts: [unity-catalog-overview]
  - name: "Models"
    concepts: [ai-playground, foundation-model-apis, ai-gateway-basics, batch-inference-ai-query, structured-outputs, provisioned-throughput, external-models]
  - name: "Retrieval"
    concepts: [vector-search-basics, rag-pipeline, ai-search-indexes]
  - name: "Agents"
    concepts: [agent-framework, agent-tools-uc-functions, mcp-on-databricks, agent-bricks, agent-deployment-apps, model-services, agent-and-mcp-services, guardrails-and-service-policies, agent-memory, agent-evaluation, evaluation-datasets, human-feedback, prompt-registry, genai-production-monitoring, gateway-usage-and-inference-tables]
---

Retrieval before agents, and evaluation before either goes near production. Most failed generative AI projects fail at retrieval quality, not at the model, which is why the RAG concept spends most of its words on chunking and grounding.

Unity Catalog is a prerequisite and not a formality: vector indexes, agent tools and the models they call are all governed objects.
