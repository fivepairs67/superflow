WITH vip_members AS (
    SELECT
        member_id
    FROM analytics.member_scores
    WHERE score >= 90
)
SELECT
    recent.member_id,
    recent.order_month,
    (
        SELECT MAX(o2.order_dt)
        FROM commerce.orders o2
        WHERE o2.member_id = recent.member_id
    ) AS last_order_dt
FROM (
    SELECT
        o.member_id,
        date_trunc('month', o.order_dt) AS order_month,
        SUM(o.total_order_amount) AS monthly_sales
    FROM commerce.orders o
    GROUP BY 1, 2
) recent
WHERE EXISTS (
    SELECT 1
    FROM vip_members vm
    WHERE vm.member_id = recent.member_id
)
  AND recent.member_id IN (
    SELECT member_id
    FROM vip_members
)
ORDER BY recent.order_month DESC;
