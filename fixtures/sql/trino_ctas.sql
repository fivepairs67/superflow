CREATE TABLE daily_metrics AS
WITH base AS (
    SELECT
        user_id,
        event_date,
        amount,
        count_if(event_name = 'click') AS clicks
    FROM sales_events
    WHERE event_date >= date_add('day', -7, current_date)
    GROUP BY 1, 2, 3
)
SELECT
    event_date,
    approx_percentile(amount, 0.5) AS median_amount,
    sum(clicks) AS total_clicks
FROM base
GROUP BY 1;
