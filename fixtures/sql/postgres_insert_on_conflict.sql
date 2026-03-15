INSERT INTO analytics.daily_sales (
    sales_dt,
    channel,
    order_cnt,
    gross_sales
)
VALUES
    (DATE '2026-03-01', 'web', 42, 182000.50)
ON CONFLICT (sales_dt, channel)
DO UPDATE SET gross_sales = EXCLUDED.gross_sales;
