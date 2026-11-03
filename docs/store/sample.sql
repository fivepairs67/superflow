-- Fictional sample: regional customer rankings from orders, visits, and refunds.
WITH base_orders AS (
  SELECT t1.order_id,
         t1.customer_id,
         t1.ordered_at
  FROM demo.order_facts t1
  WHERE t1.ordered_at >= DATE '2026-01-01'
    AND t1.ordered_at < DATE '2026-04-01'
),
customer_value AS (
  SELECT t1.customer_id,
         COUNT(DISTINCT t1.order_id) AS order_count,
         SUM(t2.quantity * t2.unit_price) AS gross_revenue
  FROM base_orders t1
  INNER JOIN demo.order_items t2
    ON t1.order_id = t2.order_id
  GROUP BY t1.customer_id
  HAVING COUNT(DISTINCT t1.order_id) >= 3
),
visit_ranked AS (
  SELECT t1.customer_id,
         t1.visited_at,
         ROW_NUMBER() OVER (
           PARTITION BY t1.customer_id
           ORDER BY t1.visited_at DESC, t1.visit_id DESC
         ) AS visit_rank
  FROM demo.web_visits t1
  WHERE t1.visited_at >= DATE '2026-01-01'
    AND t1.visited_at < DATE '2026-04-01'
),
latest_visit AS (
  SELECT t1.customer_id,
         t1.visited_at
  FROM visit_ranked t1
  WHERE t1.visit_rank = 1
),
refund_totals AS (
  SELECT t1.customer_id,
         SUM(t1.refund_amount) AS refund_amount
  FROM demo.refund_events t1
  WHERE t1.refunded_at >= DATE '2026-01-01'
    AND t1.refunded_at < DATE '2026-04-01'
  GROUP BY t1.customer_id
),
customer_ranking AS (
  SELECT t1.customer_id,
         t1.customer_name,
         t1.region,
         t2.order_count,
         t2.gross_revenue,
         COALESCE(t4.refund_amount, 0) AS refund_amount,
         t2.gross_revenue - COALESCE(t4.refund_amount, 0) AS net_revenue,
         t3.visited_at AS last_visit_at,
         DENSE_RANK() OVER (
           PARTITION BY t1.region
           ORDER BY t2.gross_revenue - COALESCE(t4.refund_amount, 0) DESC
         ) AS region_rank
  FROM demo.customers t1
  INNER JOIN customer_value t2
    ON t1.customer_id = t2.customer_id
  LEFT JOIN latest_visit t3
    ON t1.customer_id = t3.customer_id
  LEFT JOIN refund_totals t4
    ON t1.customer_id = t4.customer_id
)
SELECT t1.customer_name,
       t1.region,
       t1.order_count,
       t1.gross_revenue,
       t1.refund_amount,
       t1.net_revenue,
       t1.last_visit_at,
       t1.region_rank
FROM customer_ranking t1
WHERE t1.region_rank <= 5;
