---
id: query-tags
title: Query tags
area: query-history
level: intermediate
summary: Key-value tags attached to a session or a single statement, surfacing in query history and the system tables, which is how warehouse spend gets an owner.
prerequisites: [query-profile, system-tables]
related: [cost-attribution-and-budgets, system-tables, query-profile, sql-warehouse-sizing, sql-warehouse-sessions]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/sql/user/queries/query-tags
    checked: 2026-09-12
aliases: [query tags, SET QUERY_TAGS, query attribution, chargeback, tagging queries]
updated: 2026-09-12
status: published
maturity: public-preview
maturity_checked: 2026-09-12
---

## What it is

A query tag is a key-value pair attached to SQL work. You set it, the queries that follow carry it, and it appears next to them in query history and in `system.query.history`.

It exists to answer the question a shared SQL warehouse cannot otherwise answer: which team, which dashboard, which job is responsible for this bill.

> [!note]
> This is in Public Preview as of September 2026, and it is not on any exam guide. Useful, but check the label before it becomes part of a chargeback process somebody depends on.

## Why it exists

Warehouse cost is measured per warehouse. That is the wrong grain for almost every question people ask about it. Three teams share a warehouse because sharing is cheaper than three idle warehouses, and then nobody can say which of the three is responsible for the spike on Tuesday.

The usual workarounds are bad in specific ways. One warehouse per team costs more and starts cold more often. Guessing from the query text works until two teams use the same table. Tagging the compute, which is what [[cost-attribution-and-budgets|cluster and serverless tags]] do, attributes the warehouse but not the query.

Query tags put the label on the unit of work itself.

## How it works

### Two scopes

**Session level** applies to everything that follows in the session. Set it with `SET QUERY_TAGS` or with the session configuration parameter:

```sql
SET QUERY_TAGS = 'team=finance,dashboard=revenue_daily';

-- Every statement from here carries those tags.
SELECT sum(amount) FROM main.gold.daily_revenue WHERE order_date >= current_date() - 30;
```

**Statement level** applies to one statement, and is set by the client rather than in SQL. It is supported by the Python connector from 4.2.6, the Node.js connector from 1.12.0, the Go connector from 1.9.0, and the Statement Execution API. This is the one that matters for an application serving many users through one connection: the session belongs to the pool, the statement belongs to the request.

### Where the tags come out

Three places: the Query History page in the workspace, the `ListQueries` API, and `system.query.history`, which is the one that makes them worth setting.

```sql
-- Warehouse time by team, from the tags the queries carried.
SELECT
  query_tags['team']                                        AS team,
  count(*)                                                  AS queries,
  round(sum(total_duration_ms) / 1000 / 60, 1)              AS warehouse_minutes
FROM system.query.history
WHERE start_time >= current_date() - INTERVAL 30 DAYS
  AND query_tags['team'] IS NOT NULL
GROUP BY 1
ORDER BY warehouse_minutes DESC;
```

Note what this is not: it is not money. It is time and query counts, which you convert to money by joining the warehouse's usage in [[system-tables|the billing system table]]. Tags tell you the proportions; billing tells you the total.

### The limits, which are small enough to design around

| Limit | Value |
| --- | --- |
| Total tag data per session | 10 KB |
| User-specified tags | 20 |
| Key or value length | 128 characters |
| Characters not allowed in a key | `,` `:` `-` `/` `=` `.` |
| Reserved prefix | keys starting with `@@` |

Twenty tags is plenty for a taxonomy and not enough for a debug dump. Pick three or four keys and use them everywhere: team, application, environment, and whatever your organisation actually charges against.

## Example: tagging from a connector

```python
# The session belongs to the connection pool, so the tag belongs to the statement.
from databricks import sql

with sql.connect(server_hostname=host, http_path=path, access_token=token) as conn:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM main.gold.orders WHERE order_date = ?",
            parameters=[order_date],
            query_tags={"team": "finance", "app": "close-report", "env": "prod"},
        )
        rows = cur.fetchall()
```

A week later, `system.query.history` can say that the close report ran 4,000 times, took eleven warehouse-hours, and belongs to finance. Without the tags it is four thousand anonymous queries against a table finance is not the only user of.

## Common mistakes

- **Setting tags in the session of a shared connection pool.** Every request then carries the first request's tags. Tag the statement.
- **Inventing a key per question.** Twenty tags and 10 KB go quickly, and a taxonomy nobody agreed on is not a taxonomy. Agree on the keys first.
- **Using a dot or a dash in a key.** Neither is allowed, and the failure is at set time rather than at query time.
- **Reading duration as cost.** Query duration is not DBUs. Join to billing before anybody is charged for anything.
- **Building the chargeback process on it today.** It is in Public Preview. Prototype the report, keep the invoice on something generally available.
