SELECT
    t1.*,
    t2.sentiment,
    t2.sentiment_score
FROM analytics.news_mk AS t1
JOIN analytics.news_mk_analysis AS t2
    ON t1.link = t2.link
WHERE t1.pub_date >= (NOW() AT TIME ZONE 'UTC') - INTERVAL '2 hours'
  AND t1.category <> '전체뉴스'
  AND (
        t2.sentiment_score >= 0.6
        OR t2.sentiment_score <= -0.6
      )
ORDER BY t1.pub_date DESC;
