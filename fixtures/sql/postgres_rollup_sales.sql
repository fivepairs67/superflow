SELECT
    region,
    channel,
    SUM(amount) AS total_amount
FROM orders
GROUP BY ROLLUP (region, channel)
HAVING SUM(amount) > 0
ORDER BY region, channel;
