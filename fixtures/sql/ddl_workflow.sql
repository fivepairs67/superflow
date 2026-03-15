CREATE TEMP TABLE news_today AS
SELECT *
FROM analytics.news_mk
WHERE date = TO_CHAR((NOW() AT TIME ZONE 'Asia/Seoul'), 'YYYYMMDD');

CREATE TEMP TABLE news_enriched AS
SELECT
    t1.*,
    t2.sentiment,
    t2.sentiment_score
FROM news_today AS t1
LEFT JOIN analytics.news_mk_analysis AS t2
  ON t1.link = t2.link;

SELECT *
FROM news_enriched
WHERE sentiment_score >= 0.5
ORDER BY pub_date DESC
LIMIT 100;
