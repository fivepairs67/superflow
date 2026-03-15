SELECT
    user_id,
    item
FROM events
LATERAL VIEW explode(items) exploded AS item;
