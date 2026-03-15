SELECT
    order_id,
    amount
FROM orders TABLESAMPLE BERNOULLI (10) REPEATABLE (1)
WHERE amount > 0
ORDER BY order_id
OFFSET 5;
