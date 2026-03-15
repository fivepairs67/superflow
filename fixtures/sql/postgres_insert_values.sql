INSERT INTO analytics.daily_sales (
    sales_dt,
    channel,
    order_cnt,
    gross_sales
)
VALUES
    (DATE '2026-03-01', 'web', 42, 182000.50),
    (DATE '2026-03-01', 'app', 31, 129500.00),
    (DATE '2026-03-01', 'store', 12, 48600.25);
