-- Fictional staging steps for Script View; append sample.sql after this file.
DROP TABLE IF EXISTS demo.order_facts;
CREATE TABLE demo.order_facts AS
SELECT t1.order_id,
       t1.customer_id,
       t1.ordered_at
FROM demo.orders t1
WHERE t1.status = 'completed';

CREATE TABLE demo.refund_events AS
SELECT t1.customer_id,
       t1.refunded_at,
       t1.refund_amount
FROM demo.refunds t1
WHERE t1.status = 'approved';
