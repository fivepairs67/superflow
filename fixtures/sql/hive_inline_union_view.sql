CREATE TABLE demo.union_view_target AS
SELECT x.id
FROM (
    SELECT id
    FROM demo.source_a
    WHERE part_dt = '20260101'
    UNION ALL
    SELECT id
    FROM demo.source_a
    WHERE log_seq = '0'
) x;
