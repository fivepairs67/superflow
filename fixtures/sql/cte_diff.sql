WITH base AS (
    SELECT
        date,
        sector,
        SUM(weighted_score) AS weighted_score
    FROM analytics.vw_sector_daily_index
    WHERE date >= TO_CHAR(current_date - interval '7 day', 'YYYYMMDD')
    GROUP BY date, sector
),
diff AS (
    SELECT
        sector,
        date,
        weighted_score,
        weighted_score - LAG(weighted_score)
        OVER(PARTITION BY sector ORDER BY date) AS diff_score
    FROM base
)
SELECT *
FROM diff
ORDER BY ABS(diff_score) DESC;
