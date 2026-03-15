SELECT date, category,
COUNT(*) AS CNT
FROM analytics.news_mk
GROUP BY date, category
ORDER BY date, category
LIMIT 1000;

SELECT *
FROM analytics.news_mk
WHERE DATE = '20251124'
ORDER BY title
LIMIT 10000;

SELECT *
FROM analytics.vw_sector_daily_index
LIMIT 10;

SELECT *
FROM analytics.news_mk
WHERE category != '전체뉴스'
ORDER BY pub_date DESC
LIMIT 1000;

SELECT *
FROM information_schema.columns
WHERE table_name IN ('news_mk_analysis', 'news_mk', 'vw_sector_daily_index');
