DELETE FROM orders o
USING refunds r
WHERE o.order_id = r.order_id
  AND r.status = 'APPROVED';
