-- Fictional sample: customer order totals and regional reporting.
DROP TABLE IF EXISTS demo.customer_totals;
CREATE TABLE demo.customer_totals AS
WITH paid_orders AS (
  SELECT customer_id, order_id, amount
  FROM demo.orders
  WHERE status = 'paid'
),
order_totals AS (
  SELECT customer_id,
         COUNT(order_id) AS order_count,
         SUM(amount) AS total_amount
  FROM paid_orders
  GROUP BY customer_id
)
SELECT t1.customer_id,
       t1.customer_name,
       t1.region,
       COALESCE(t2.order_count, 0) AS order_count,
       COALESCE(t2.total_amount, 0) AS total_amount
FROM demo.customers t1
LEFT JOIN order_totals t2
  ON t1.customer_id = t2.customer_id;

CREATE TABLE demo.region_totals AS
SELECT region, SUM(total_amount) AS revenue
FROM demo.customer_totals
GROUP BY region;

SELECT t1.customer_name,
       t1.region,
       t1.total_amount,
       t2.revenue AS region_revenue
FROM demo.customer_totals t1
LEFT JOIN demo.region_totals t2
  ON t1.region = t2.region
WHERE t1.total_amount > 0
ORDER BY total_amount DESC
LIMIT 50;
