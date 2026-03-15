MERGE INTO dim_customer d
USING staging_customer s
ON d.customer_id = s.customer_id
WHEN MATCHED THEN
    UPDATE SET
        customer_name = s.customer_name,
        updated_at = s.updated_at
WHEN NOT MATCHED THEN
    INSERT (customer_id, customer_name, updated_at)
    VALUES (s.customer_id, s.customer_name, s.updated_at);
