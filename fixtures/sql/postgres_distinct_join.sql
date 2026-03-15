SELECT DISTINCT
    c.customer_id,
    c.customer_name
FROM customers c
LEFT JOIN orders o
    ON o.customer_id = c.customer_id
WHERE o.status = 'DONE'
ORDER BY c.customer_id;
