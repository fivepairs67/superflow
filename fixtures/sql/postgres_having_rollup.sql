SELECT
    customer_id,
    SUM(amount) AS total_amount
FROM orders
GROUP BY customer_id
HAVING SUM(amount) > 1000
ORDER BY total_amount DESC;
