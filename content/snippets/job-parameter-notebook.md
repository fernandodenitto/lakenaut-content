```sql
-- SQL task: the start_date parameter arrives as a named parameter marker
SELECT order_id, amount
FROM main.silver.orders
WHERE order_date >= :start_date;
```

```python
# Notebook task: the start_date parameter arrives as a widget
start_date = dbutils.widgets.get("start_date")

df = spark.table("main.silver.orders").filter(f"order_date >= '{start_date}'")
display(df.select("order_id", "amount"))
```
