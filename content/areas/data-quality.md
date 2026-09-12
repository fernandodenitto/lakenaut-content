---
id: data-quality
title: Data Quality
label: Data Quality
sidebar_group: data-engineering
order: 5
aliases: [quality, data validation, expectations, dqx]
summary: "Keeping bad rows out of silver and gold: pipeline expectations, Delta constraints, the DQX framework, and the monitoring that tells you when quality drifts."
concept_order: [data-quality-overview, data-quality-monitoring, dqx-framework]
---

Data quality on Databricks is not one feature. Expectations live inside declarative pipelines, constraints live on the table, DQX validates any PySpark DataFrame from any job, and monitoring watches the numbers over time. This area is about picking the right one and wiring it so a bad row is visible instead of silently averaged into a dashboard.
