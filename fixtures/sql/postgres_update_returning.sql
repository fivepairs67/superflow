UPDATE analytics.daily_sales
SET gross_sales = gross_sales + 1000
WHERE sales_dt = DATE '2026-03-01'
RETURNING sales_dt, gross_sales;
