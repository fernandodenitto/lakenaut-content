---
id: genie-benchmarks-monitoring
title: Genie benchmarks, feedback and monitoring
area: genie
level: intermediate
summary: Benchmarks measure a Genie Agent against questions with known answers; the Monitoring tab and user feedback show what real users ask and where it fails. Together they drive every change to the agent.
prerequisites: [genie-agents, genie-knowledge-store]
related: [genie-conversation-api, agent-evaluation]
exams:
  - cert: data-analyst-associate
    domain: "Developing, Sharing, and Maintaining AI/BI Genie spaces"
    objective: "Optimize AI/BI Genie spaces by tracking user questions, response accuracy, and feedback; updating instructions and trusted assets based on stakeholder input; validating accuracy with benchmarks; refreshing Unity Catalog metadata."
sources:
  - url: https://docs.databricks.com/aws/en/genie-agents/monitor
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/genie-agents/best-practices
    checked: 2026-09-11
  - url: https://docs.databricks.com/aws/en/genie-agents/talk-to-genie
    checked: 2026-09-11
aliases: [genie benchmarks, genie evaluation, genie monitoring, genie feedback, request review, fix it]
updated: 2026-09-11
status: published
---

## What it is

Three instruments tell an author whether a [[genie-agents|Genie Agent]] can be trusted:

- **Benchmarks**: a set of test questions, each with an optional ground-truth SQL query, that Genie answers on demand and gets graded on.
- **User feedback**: the rating and comments people leave on each answer.
- The **Monitoring tab**: every question asked, with its answer, rating and status, plus usage trends.

## Why it exists

An agent that looked right in the author's own tests will meet phrasings nobody anticipated, and Genie does not improve by itself: feedback is a signal for the author, not training data for the model. Without benchmarks, every change to the knowledge store is a guess that might fix one question and silently break three others. Without monitoring, nobody knows which questions users actually ask.

## How it works

### Benchmarks

An agent holds up to **500 benchmark questions**. For each one you can store the correct SQL (Genie can draft it with *Generate SQL*, and you review it). A benchmark run asks every question fresh and grades the result:

- In **chat mode**, Genie compares the result set of its answer with the ground truth (up to 5,000 rows). A result counts as **Good** when it matches, including a different sort order or numbers equal to four significant digits; otherwise **Bad**, or **Manual review needed** when no automatic call is possible.
- In **Agent mode**, LLM judges grade the report, optionally guided by evaluation notes you write.

Include several phrasings of the same question: a benchmark set with one wording per question measures memorisation of your examples, not robustness. Genie Code can diagnose a failed benchmark and suggest the change that would fix it.

### Feedback from users

Under each answer users see **Is this correct?** with three choices:

- **Yes**: a positive rating.
- **Fix it**: the user explains what is wrong, and Genie regenerates the answer (or the note is just recorded).
- **Request review**: the conversation is flagged for the agent's managers.

Feedback and review requests are visible only to users with `CAN MANAGE` on the agent. Conversation visibility is set per agent: private, reviewable by agent managers (the default) or visible to all account users.

### The Monitoring tab

It lists every message with filters by time, rating, user and status, and adds a weekly digest (message volume, active users, feedback trends). Read it for three things: questions that failed or were rated down, questions nobody expected (a missing table or synonym), and questions that should not be asked here at all (a hint that a second agent is needed).

### The improvement loop

1. Pick a failure from monitoring or a review request.
2. Fix it at the lowest layer that can: Unity Catalog comment, knowledge store, example query, then text (see [[genie-knowledge-store]]).
3. Add the question, and a couple of rephrasings, to the benchmarks with the correct SQL.
4. Re-run the whole benchmark set to check nothing else regressed.
5. When the underlying tables change, refresh the Unity Catalog metadata and re-run again.

## Example

A benchmark entry and the fix it motivated:

```sql
-- Benchmark question: "How many active customers do we have in Italy?"
-- Ground truth SQL
SELECT COUNT(*) AS active_customers
FROM sales.gold.customers
WHERE country_code = 'IT'
  AND status = 'active'
  AND churned_at IS NULL;
-- First run: Bad. Genie filtered country = 'Italy' and ignored churned_at.
-- Fix: a knowledge-store filter "active customer" plus entity matching on country_code.
-- Re-run: Good, and the other 60 benchmarks still pass.
```

## Common mistakes

- Treating a thumbs-down as a fix. Genie never retrains on feedback; somebody has to change the agent.
- Benchmarks without ground-truth SQL, which leave every result to manual review.
- One phrasing per benchmark question, which overstates accuracy.
- Changing instructions and shipping without re-running the benchmark set.
- Never opening the Monitoring tab, and so never learning which questions users actually ask.

> [!exam]
> For "how do you improve and validate a Genie space over time", the expected moves are: **track user questions and feedback in monitoring, update instructions and trusted assets, validate with benchmarks, refresh Unity Catalog metadata**. Remember that feedback reaches the people with `CAN MANAGE`, and that nothing improves automatically.
