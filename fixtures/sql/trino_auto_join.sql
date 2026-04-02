WITH base AS (
  SELECT
    user_id,
    TRY(date_parse(event_ts_raw, '%Y%m%d%H%i%s')) AS event_ts
  FROM "11ST".BASE_11ST_AUTO_CLIENT_LOG
)
SELECT
  b.user_id,
  d.direct_flag
FROM base b
LEFT JOIN dim_users d
  ON b.user_id = d.user_id;
