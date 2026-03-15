WITH src AS (
    SELECT user_id, amount, event_ts
    FROM sales
)
SELECT
    count_if(amount > 0) AS paid_cnt,
    approx_percentile(amount, 0.5) AS p50_amount,
    date_diff('day', date(event_ts), current_date) AS days_from_event
FROM src;
