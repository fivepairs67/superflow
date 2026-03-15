UPDATE accounts a
SET tier = src.tier
FROM (
    SELECT
        account_id,
        MAX(tier) AS tier
    FROM account_tiers
    GROUP BY account_id
) src
WHERE src.account_id = a.account_id;
