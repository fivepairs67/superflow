SET hivevar:vBaseDate = date_sub(current_date, 1);
SET hive.execution.engine = tez;

SELECT
    dt,
    COUNT(*) AS order_cnt
FROM sales.daily_orders
WHERE dt = '${hivevar:vBaseDate}'
GROUP BY dt;
