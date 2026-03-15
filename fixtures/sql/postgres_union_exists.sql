WITH active_orders AS (
    SELECT customer_id, order_id
    FROM orders
    WHERE status = 'DONE'
),
refund_orders AS (
    SELECT customer_id, order_id
    FROM refunds
    WHERE state = 'APPROVED'
)
SELECT customer_id, order_id
FROM active_orders
UNION ALL
SELECT customer_id, order_id
FROM refund_orders
WHERE EXISTS (
    SELECT 1
    FROM customers c
    WHERE c.customer_id = refund_orders.customer_id
);
