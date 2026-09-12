---
id: genai-engineer-associate
title: Generative AI Engineer Associate
short: GenAI Engineer
exam_guide_version: "2026-03"
exam_guide_url: https://www.databricks.com/sites/default/files/2026-03/Databricks-Certified-Generative-AI-Engineer-Associate-Exam-Guide-Mar26.pdf
exam_page_url: https://www.databricks.com/learn/certification/genai-engineer-associate
questions: 45
minutes: 90
summary: The associate-level certification for designing and implementing LLM-enabled solutions on Databricks, covering prompt design, RAG pipelines, agent frameworks, AI Search (formerly Vector Search), Model Serving, and MLflow-based evaluation.
prerequisite_tracks: [foundations-sql, foundations-python]
full_resources: []
domains:
  - name: "Design Applications"
    objectives:
      - "Design a prompt that elicits a specifically formatted response"
      - "Select model tasks to accomplish a given business requirement"
      - "Select chain components for a desired model input and output"
      - "Translate business use case goals into a description of the desired inputs and outputs for the AI pipeline"
      - "Define and order tools that gather knowledge or take actions for multi-stage reasoning"
      - "Determine how and when to use Agent Bricks (Knowledge Assistant, Multiagent Supervisor, Information Extraction) to solve problems"
    concepts: [ai-playground, foundation-model-apis, agent-framework, agent-tools-uc-functions, ai-functions-sql, structured-outputs, agent-bricks]
  - name: "Data Preparation"
    objectives:
      - "Apply a chunking strategy for a given document structure and model constraints"
      - "Filter extraneous content in source documents that degrades quality of a RAG application"
      - "Choose the appropriate Python package to extract document content from provided source data and format"
      - "Define operations and sequence to write given chunked text into Delta Lake tables in Unity Catalog"
      - "Identify needed source documents that provide necessary knowledge and quality for a given RAG application"
      - "Use tools and metrics to evaluate retrieval performance"
      - "Design retrieval systems using advanced chunking strategies"
      - "Explain the role of re-ranking in the information retrieval process"
    concepts: [rag-pipeline, vector-search-basics, semi-structured-data]
  - name: "Application Development"
    objectives:
      - "Select LangChain or similar tools for use in a Generative AI application"
      - "Qualitatively assess responses to identify common issues such as quality and safety"
      - "Select a chunking strategy based on model and retrieval evaluation"
      - "Augment a prompt with additional context from a user's input based on key fields, terms, and intents"
      - "Create a prompt that adjusts an LLM's response from a baseline to a desired output"
      - "Implement LLM guardrails to prevent negative outcomes"
      - "Select the best LLM based on the attributes of the application to be developed"
      - "Select an embedding model context length based on source documents, expected queries, and optimization strategy"
      - "Select a model from a model hub or marketplace for a task based on model metadata and model cards"
      - "Select the best model for a given task based on common metrics generated in experiments"
      - "Utilize MLflow and Agent Framework for developing agentic systems"
      - "Compare the evaluation and monitoring phases of the Gen AI application life cycle"
      - "Enable multi-agent systems to leverage Genie Spaces or the conversational API to retrieve data"
    concepts: [agent-framework, mlflow-tracking, foundation-model-apis, genie-conversation-api, batch-inference-ai-query]
  - name: "Assembling and Deploying Applications"
    objectives:
      - "Code a chain using a pyfunc model with pre- and post-processing"
      - "Control access to resources from model serving endpoints"
      - "Code a simple chain according to requirements"
      - "Choose the basic elements needed to create a RAG application: model flavor, embedding model, retriever, dependencies, input examples, model signature"
      - "Register the model to Unity Catalog using MLflow"
      - "Create and query a Vector Search index"
      - "Identify how to serve an LLM application that leverages Foundation Model APIs"
      - "Explain the key concepts and components of Mosaic AI Vector Search"
      - "Identify batch inference workloads and apply ai_query() appropriately"
      - "Configure vector search for a particular solution based on number of embeddings, update frequency, latency, and cost requirements"
      - "Configure a persistent datastore to store and retrieve intermediate memory or structured information"
      - "Apply CI/CD best practices such as updating a Vector Search index, promoting prompts across environments, and testing individual components of an agent"
      - "Integrate managed, external, and custom MCP servers based on given application requirements"
      - "Apply prompt version control and manage the prompt lifecycle"
      - "Develop an appropriate interactive user-facing interface for an agent usage scenario (Apps, Slack, Teams, etc.)"
    concepts: [models-in-uc, model-serving-endpoints, vector-search-basics, bundles-overview, ai-search-indexes, agent-deployment-apps, mcp-on-databricks, provisioned-throughput]
  - name: "Governance"
    objectives:
      - "Use masking techniques as guardrails to meet a performance objective"
      - "Select guardrail techniques to protect against malicious user inputs to a Gen AI application"
      - "Use legal and licensing requirements for data sources to avoid legal risk"
      - "Recommend an alternative for problematic text mitigation in a data source feeding a GenAI application"
    concepts: [guardrails-and-service-policies, row-filters-column-masks, abac-policies, model-services]
  - name: "Evaluation and Monitoring"
    objectives:
      - "Select an LLM choice (size and architecture) based on a set of quantitative evaluation metrics"
      - "Select key metrics to monitor for a specific LLM deployment scenario"
      - "Evaluate agent performance using MLflow scoring and tracing"
      - "Use inference logging to assess deployed RAG application performance"
      - "Use Databricks features to control LLM costs"
      - "Use inference tables and Agent Monitoring to track a live LLM endpoint"
      - "Identify evaluation judges that require ground truth"
      - "Use AI Gateway (inference tables, usage tables, and rate limiting) to track an LLM or agent deployed via Agent Framework"
      - "Use Databricks custom scorers for evaluating agents and LLMs"
      - "Incorporate SME feedback to improve agent performance"
    concepts: [agent-evaluation, ai-gateway-basics, mlflow-tracking, mlflow-tracing, evaluation-datasets, human-feedback, gateway-usage-and-inference-tables]
---

## How to use this roadmap

The six domains follow the order of the official exam guide (live as of March 18, 2026). No domain publishes a percentage weight in this version, so treat every section as equally likely and use the objective bullets, not the domain order, to judge how deep to go.

What makes this exam different from the data engineering tracks: it tests architecture judgment more than syntax. Expect scenario questions about picking a chunking strategy, choosing between a managed and a custom MCP server, or deciding when Agent Bricks beats a hand-built chain, often with more than one technically valid answer. Governance has no matching concept yet in this vault: PII masking as an LLM guardrail and licensing risk for training data are exam topics with no page to read here yet, so lean on the official documentation for that section.

> [!exam]
> No domain weights are published for this exam guide version. Most questions build a RAG or agent scenario and ask you to justify a tool choice, not recall a single fact — study the "why" behind AI Search (the guide still says Vector Search), MCP, and Agent Framework, not just their names.
