SELECT
    customer_id,
    order_month,
    ROW_NUMBER() OVER (
        PARTITION BY customer_id
        ORDER BY order_month DESC
    ) AS rn
FROM monthly_sales
QUALIFY rn = 1;
