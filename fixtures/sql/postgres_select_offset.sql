SELECT
    order_id,
    customer_id,
    created_at
FROM orders
WHERE status = 'DONE'
ORDER BY created_at DESC
OFFSET 10;
