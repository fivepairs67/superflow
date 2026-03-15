WITH monthly_sales AS (
    SELECT
        o.customer_id,
        DATE_TRUNC('month', o.ordered_at) AS order_month,
        SUM(oi.quantity * oi.unit_price) AS monthly_amount,
        COUNT(DISTINCT o.order_id) AS order_count
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.status = 'DONE'
      AND o.ordered_at >= (
          SELECT MAX(ordered_at) - INTERVAL '6 months'
          FROM orders
          WHERE status = 'DONE'
      )
    GROUP BY o.customer_id, DATE_TRUNC('month', o.ordered_at)
),
vip_candidates AS (
    SELECT
        customer_id,
        SUM(monthly_amount) AS total_spent,
        SUM(order_count) AS total_orders
    FROM monthly_sales
    GROUP BY customer_id
    HAVING SUM(monthly_amount) >= (
        SELECT AVG(cust_total)
        FROM (
            SELECT SUM(monthly_amount) AS cust_total
            FROM monthly_sales
            GROUP BY customer_id
        ) avg_sub
    )
)
SELECT
    c.name AS customer_name,
    ms.order_month,
    ms.monthly_amount,
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM vip_candidates vc
            WHERE vc.customer_id = c.customer_id
        ) THEN 'VIP'
        ELSE 'NORMAL'
    END AS vip_flag,
    (
        SELECT p_inner.name
        FROM order_items oi_inner
        JOIN orders o_inner ON o_inner.order_id = oi_inner.order_id
        JOIN products p_inner ON p_inner.product_id = oi_inner.product_id
        WHERE o_inner.customer_id = c.customer_id
          AND DATE_TRUNC('month', o_inner.ordered_at) = ms.order_month
        ORDER BY oi_inner.quantity * oi_inner.unit_price DESC
        LIMIT 1
    ) AS top_product_name
FROM monthly_sales ms
JOIN customers c ON c.customer_id = ms.customer_id
WHERE c.customer_id IN (
    SELECT customer_id
    FROM vip_candidates
)
ORDER BY ms.order_month DESC;
