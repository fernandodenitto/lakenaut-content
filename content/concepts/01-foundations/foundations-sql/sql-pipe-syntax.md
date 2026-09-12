---
id: sql-pipe-syntax
title: Pipe syntax for queries
area: foundations-sql
level: intermediate
summary: "The |> operator chains query operators in the order the engine applies them, so a query reads top to bottom and a second aggregation is one more line instead of a subquery."
prerequisites: [spark-sql-basics, sql-joins-and-sets]
related: [sql-window-functions, sql-merge-and-dml, query-profile, sql-editor-basics]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-qry-select-pipeop
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-qry-pipeline
    checked: 2026-09-12
aliases: [pipe syntax, pipe operator, "|>", piped operation, sql pipeline syntax, AGGREGATE operator, EXTEND]
updated: 2026-09-12
status: published
maturity: ga
---

## What it is

Any query on Databricks can be followed by a chain of **pipe operators**, each separated by the token `|>` and each consuming the result of the one before it. A pipeline normally starts with `FROM main.silver.orders` or `TABLE main.silver.orders`, but any query can start one, and there is no limit on how many operators you chain or in what order.

It needs Databricks SQL, or Databricks Runtime 16.2 and above. It is not a preview, not a dialect flag, and not something you turn on: on a supported runtime the parser accepts it alongside ordinary SQL, and the two forms can sit in the same query.

## Why it exists

SQL's clause order is not its evaluation order, on Databricks as anywhere else (see [[spark-sql-basics]]). You write `SELECT ... FROM ... WHERE ... GROUP BY ... HAVING ... ORDER BY`, and the engine reads `FROM`, then `WHERE`, then `GROUP BY`, then `HAVING`, then `SELECT`, then `ORDER BY`. Every reader of SQL has internalised that mismatch, so nobody notices the cost until the query gets long: a second aggregation has to become a nested subquery, and the logical first step ends up buried in the innermost parentheses, furthest from where you start reading.

Pipe syntax puts the operators in the order they happen. You read the query top to bottom, each line does one thing, and stacking another transformation means appending a line rather than wrapping everything you already wrote in a new `SELECT`. It is also easier to build incrementally: run it, look at the result, add the next `|>`.

## How it works

### The operators

| Operator | What it does |
| --- | --- |
| `SELECT` | replaces the select list. From Databricks Runtime 18.0 it may also contain aggregate functions with an optional `GROUP BY` |
| `EXTEND` | appends new columns, and a later expression can reference an alias defined earlier in the same `EXTEND` |
| `SET` | overwrites existing columns in place, left to right, so a later expression sees earlier updates |
| `DROP` | removes columns |
| `AS` | names the result so later operators can qualify it |
| `WHERE` | filters |
| `LIMIT`, `OFFSET` | truncate and skip |
| `AGGREGATE expr [, ...] [GROUP BY ...]` | aggregates. Grouping columns come out before the aggregated ones |
| `JOIN` | joins the pipeline to another relation |
| `ORDER BY` | orders across partitions |
| `UNION`, `EXCEPT`, `INTERSECT` | set operations against a subquery |
| `TABLESAMPLE` | samples a fraction or a row count |
| `PIVOT`, `UNPIVOT` | reshapes columns into rows and back |

Operators can appear in any order and any number of times, which is the part classic SQL cannot do. Each keeps its ordinary grammar, so the joins and set operations in [[sql-joins-and-sets]] transfer across unchanged.

Two details are easy to get wrong. Every expression in `AGGREGATE` must contain an aggregate function, or you get `PIPE_OPERATOR_AGGREGATE_EXPRESSION_CONTAINS_NO_AGGREGATE_FUNCTION`; put one in an operator that does not accept it and you get `PIPE_OPERATOR_CONTAINS_AGGREGATE_FUNCTION`. And an integer in `AGGREGATE ... GROUP BY 1` identifies a column of the **input** to the operator, not of the result it generates, which is the reverse of what a plain `GROUP BY` does.

Because `WHERE` can appear after `AGGREGATE`, there is no `HAVING`. Filtering on an aggregate is just another `|> WHERE` further down the chain.

### What changed in Databricks Runtime 18.0

Two changes, both worth knowing because they decide how the query is written:

- `|` is accepted in place of `|>`. The long token still works, and remains the only one that parses on 16.2 through 17.3 LTS.
- The `SELECT` operator can contain aggregate functions and carry its own `GROUP BY`, returning only the expressions written before the `GROUP BY`. Omit the `GROUP BY` and all rows form one group, so `|> SELECT sum(col) AS total` is a whole-table aggregate. Before 18.0, aggregation had to go through `AGGREGATE`.

### It buys readability, not speed

The reference presents the pipe form and the nested-subquery form as two ways of writing the same query, and makes no performance claim about either. Nothing about the syntax changes what the engine does: the same joins, the same aggregation, the same scan, the same plan. If you want to be sure, run both and compare in [[query-profile]].

So it is worth reaching for when a query is hard to read or hard to extend, and worth nothing at all when a query is slow. A pipeline over a badly laid-out table (see [[data-layout-partitioning-zorder]]) on an undersized warehouse is exactly as slow as the subquery it replaced.

## Example: ninety days of revenue by week and country

```sql
FROM main.silver.orders
|> WHERE order_date >= current_date() - INTERVAL 90 DAYS
|> JOIN main.silver.customers USING (customer_id)
|> EXTEND date_trunc('WEEK', order_date) AS order_week
|> AGGREGATE sum(amount) AS revenue, count(*) AS orders
   GROUP BY order_week, country
|> EXTEND revenue / orders AS avg_order_value
-- Filtering on an aggregate, with no HAVING and no wrapper query.
|> WHERE orders >= 50
|> ORDER BY order_week DESC, revenue DESC
|> LIMIT 100;
```

The same logic in ordinary SQL needs a subquery, because the second set of expressions has to see the aggregates:

```sql
SELECT order_week, country, revenue, orders, revenue / orders AS avg_order_value
FROM (
  SELECT date_trunc('WEEK', o.order_date) AS order_week,
         c.country,
         sum(o.amount) AS revenue,
         count(*) AS orders
  FROM main.silver.orders o
  JOIN main.silver.customers c USING (customer_id)
  WHERE o.order_date >= current_date() - INTERVAL 90 DAYS
  GROUP BY 1, 2
)
WHERE orders >= 50
ORDER BY order_week DESC, revenue DESC
LIMIT 100;
```

Both produce the same result and the same work. The difference is that the first one can be read from the top and extended at the bottom, and the second one has to be read from the middle outwards. On a runtime at 18.0 or above the first can also drop `AGGREGATE` for `SELECT sum(amount) AS revenue, count(*) AS orders GROUP BY order_week, country`.

## Common mistakes

- **Repeating a clause the leading query already carried.** `SELECT * FROM t ORDER BY a |> ORDER BY b` raises `MULTIPLE_QUERY_RESULT_CLAUSES_WITH_PIPE_OPERATORS`. Start the pipeline with a bare `FROM` or `TABLE` and let the operators do all the work.
- **Putting a grouping column in `AGGREGATE`.** Only aggregate expressions go before the `GROUP BY`; the grouping columns go in it, and they come out first in the result.
- **Reading `GROUP BY 1` inside `AGGREGATE` as the first output column.** It counts columns of the input to that operator.
- **Using the short `|` token on an older runtime.** It parses from Databricks Runtime 18.0. Anything earlier needs `|>`, so a query written on the newest runtime can fail on a 17.3 LTS cluster for no reason a reader would guess.
- **Expecting the rewrite to make a slow query fast.** It is the same plan. If the query was slow, fix the layout or the warehouse (see [[sql-warehouse-sizing]]), not the punctuation.
- **Converting a whole repository of queries overnight.** The floor is Databricks SQL or Databricks Runtime 16.2, so anything that still runs on an older cluster stops parsing. Convert the queries people actually struggle to read.
