---
id: alert-compute-and-cost
title: What an alert costs to run
area: alerts
level: beginner
summary: An alert runs on a warehouse you choose, and the schedule decides the bill. Serverless with a short auto-stop, alerts grouped on one warehouse, and the startup delay counted in.
prerequisites: [alerts-overview]
related: [alerts-overview, sql-warehouse-sizing, sql-warehouse-types-and-channels, query-tags, cost-attribution-and-budgets]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/sql/user/alerts/compute
    checked: 2026-09-12
aliases: [alert compute, alert cost, alert schedule, alert warehouse, auto-stop]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

An alert is a query on a schedule with a condition attached. That query has to run somewhere, and the somewhere is a SQL warehouse you pick when you create the alert.

Which makes an alert a recurring compute cost, not a free notification. Ten alerts on a five-minute schedule is a warehouse that never sleeps, whatever the auto-stop setting says.

## Why it exists as a question

Nobody plans for this. Alerts arrive one at a time, each one obviously worth having, each one apparently costing nothing. Six months later the workspace has forty of them, half firing against tables that update daily on schedules that check every ten minutes, and somebody asks why the warehouse in the billing report never stops.

The fix is not fewer alerts. It is choosing the warehouse and the schedule with the same care you would give a job.

## How it works

### Which warehouse

Databricks recommends a **serverless** warehouse for most alerts, because the startup time is low and an alert on a schedule frequently finds the warehouse stopped. Serverless also bills for active query time rather than for the wall clock the warehouse is up, which is the right billing shape for work measured in seconds.

The second recommendation is size: the smallest warehouse that runs the alert query reliably. An alert query that needs a large warehouse is usually a query that should be a materialized view the alert then reads, as in [[materialized-views-sql]].

### The startup delay is part of the latency

When a scheduled alert fires against a stopped warehouse, the warehouse starts automatically and then the query runs. The evaluation includes that startup time.

This is the detail that makes people think their alerts are slow. An alert scheduled every five minutes against a cold classic warehouse spends most of its life starting a warehouse. The same alert on serverless, or grouped with others that keep a warehouse warm, evaluates in seconds.

### Group them

The documented advice is to put several alerts on the same warehouse so that one start serves them all. Ten alerts on one warehouse and a sensible auto-stop is a very different bill from ten alerts on ten warehouses, for identical results.

That has a corollary worth stating: the warehouse an alert runs on is a cost decision, not a permissions one. Grouping alerts does not give them each other's access.

### Choosing the schedule honestly

The schedule should match how often the underlying data can change, not how quickly you would like to know.

| The table updates | Sensible alert schedule |
| --- | --- |
| a nightly batch | once, after the job that writes it |
| hourly | hourly, offset a few minutes after the load |
| a stream | as often as the decision it drives, rarely under five minutes |

An alert that checks more often than the data changes is paying to learn nothing.

## Example: the shape that works

One serverless warehouse named `alerts`, extra small, auto-stop at five minutes. Every alert in the workspace points at it. The schedules are staggered on the hour rather than all landing at the same minute, so the warehouse serves a burst and then stops.

The alternative people build by accident is one warehouse per team, each kept warm by a single alert on a tight schedule, each idling between them. Same alerts, several times the cost.

## Common mistakes

- **A tight schedule on a daily table.** Checking every ten minutes for something that changes at 03:00 is forty evaluations to learn nothing and one to learn something.
- **A large warehouse because the query is slow.** Fix the query, or precompute it. Sizing up to make an alert finish is the expensive way to hide a missing index-equivalent.
- **One warehouse per alert.** Startups dominate the cost at this scale. Group them.
- **Forgetting the startup delay counts.** An alert on a cold classic warehouse is not late because the condition was slow to evaluate.
- **Leaving alerts owned by people who left.** An alert nobody reads still runs, still costs, and still starts a warehouse at 04:00. Review the list once a quarter.
