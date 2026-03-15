SELECT COUNT(*)
FROM analytics.news_mk
LIMIT 10000;

SELECT summary
FROM analytics.news_mk_analysis
WHERE date = '20251130'
  AND sentiment = 'positive'
ORDER BY sentiment_score DESC
LIMIT 5;
