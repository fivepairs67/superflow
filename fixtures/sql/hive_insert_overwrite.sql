INSERT OVERWRITE TABLE analytics.daily_sales
SELECT
    dt,
    category,
    SUM(amount) AS total_amount
FROM analytics.raw_sales
LATERAL VIEW explode(tags) exploded_tags AS tag
WHERE dt >= '20260101'
GROUP BY dt, category;
