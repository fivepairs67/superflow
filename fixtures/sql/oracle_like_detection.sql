SELECT
    NVL(SUM(amount), 0) AS total_amount,
    DECODE(status, 'A', 'ACTIVE', 'INACTIVE') AS status_label
FROM orders
WHERE ROWNUM <= 10;
