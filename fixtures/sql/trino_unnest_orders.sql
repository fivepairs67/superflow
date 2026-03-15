SELECT
    o.customer_id,
    item.sku
FROM orders o
CROSS JOIN UNNEST(o.items) AS item (sku);
