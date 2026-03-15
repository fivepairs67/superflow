WITH base_orders AS (
    SELECT
        o.order_id,
        o.member_id,
        o.order_dt,
        date_trunc('month', o.order_dt) AS order_month,
        o.order_status,
        o.pay_method,
        o.channel_cd,
        o.coupon_id,
        o.total_order_amount
    FROM commerce.orders o
    WHERE o.order_dt >= DATE '2025-01-01'
      AND o.order_dt < DATE '2026-01-01'
      AND o.order_status IN ('PAID', 'CONFIRMED', 'SHIPPED', 'COMPLETED')
),

order_items AS (
    SELECT
        oi.order_id,
        oi.product_id,
        oi.seller_id,
        oi.quantity,
        oi.unit_price,
        oi.discount_amount,
        (oi.quantity * oi.unit_price) AS gross_item_amount,
        (oi.quantity * oi.unit_price) - oi.discount_amount AS net_item_amount
    FROM commerce.order_items oi
),

product_dim AS (
    SELECT
        p.product_id,
        p.product_name,
        p.category_id,
        p.brand_id,
        p.seller_id AS product_seller_id,
        p.list_price,
        p.launch_dt
    FROM commerce.products p
),

category_dim AS (
    SELECT
        c.category_id,
        c.category_name,
        c.parent_category_id,
        c.depth
    FROM commerce.categories c
),

member_dim AS (
    SELECT
        m.member_id,
        m.gender,
        m.age,
        CASE
            WHEN m.age < 20 THEN '10s'
            WHEN m.age BETWEEN 20 AND 29 THEN '20s'
            WHEN m.age BETWEEN 30 AND 39 THEN '30s'
            WHEN m.age BETWEEN 40 AND 49 THEN '40s'
            ELSE '50+'
        END AS age_band,
        m.join_dt,
        m.grade_cd,
        m.region_cd
    FROM commerce.members m
),

coupon_dim AS (
    SELECT
        cp.coupon_id,
        cp.coupon_name,
        cp.coupon_type,
        cp.discount_type,
        cp.max_discount_amount
    FROM commerce.coupons cp
),

traffic_raw AS (
    SELECT
        t.member_id,
        t.session_id,
        t.event_dt,
        t.event_name,
        t.page_type,
        t.product_id,
        t.category_id,
        t.referrer_type
    FROM commerce.traffic_events t
    WHERE t.event_dt >= TIMESTAMP '2025-01-01 00:00:00'
      AND t.event_dt < TIMESTAMP '2026-01-01 00:00:00'
),

traffic_summary AS (
    SELECT
        member_id,
        date_trunc('month', event_dt) AS event_month,
        COUNT(DISTINCT session_id) AS sessions,
        COUNT_IF(event_name = 'page_view') AS page_views,
        COUNT_IF(event_name = 'add_to_cart') AS add_to_cart_cnt,
        COUNT_IF(event_name = 'purchase_click') AS purchase_click_cnt,
        COUNT(DISTINCT CASE WHEN product_id IS NOT NULL THEN product_id END) AS viewed_product_cnt
    FROM traffic_raw
    GROUP BY 1, 2
),

order_enriched AS (
    SELECT
        bo.order_id,
        bo.member_id,
        bo.order_dt,
        bo.order_month,
        bo.order_status,
        bo.pay_method,
        bo.channel_cd,
        bo.coupon_id,
        bo.total_order_amount,
        oi.product_id,
        oi.seller_id,
        oi.quantity,
        oi.unit_price,
        oi.discount_amount,
        oi.gross_item_amount,
        oi.net_item_amount,
        pd.product_name,
        pd.category_id,
        pd.brand_id,
        cd.category_name,
        md.gender,
        md.age,
        md.age_band,
        md.grade_cd,
        md.region_cd,
        cp.coupon_name,
        cp.coupon_type,
        cp.discount_type
    FROM base_orders bo
    INNER JOIN order_items oi
        ON bo.order_id = oi.order_id
    LEFT JOIN product_dim pd
        ON oi.product_id = pd.product_id
    LEFT JOIN category_dim cd
        ON pd.category_id = cd.category_id
    LEFT JOIN member_dim md
        ON bo.member_id = md.member_id
    LEFT JOIN coupon_dim cp
        ON bo.coupon_id = cp.coupon_id
),

member_order_stats AS (
    SELECT
        member_id,
        COUNT(DISTINCT order_id) AS order_cnt,
        SUM(net_item_amount) AS total_net_sales,
        AVG(net_item_amount) AS avg_item_sales,
        MAX(order_dt) AS last_order_dt,
        MIN(order_dt) AS first_order_dt,
        approx_percentile(net_item_amount, 0.5) AS median_item_sales
    FROM order_enriched
    GROUP BY 1
),

category_monthly_sales AS (
    SELECT
        order_month,
        category_id,
        category_name,
        COUNT(DISTINCT order_id) AS orders,
        COUNT(DISTINCT member_id) AS buyers,
        SUM(quantity) AS qty,
        SUM(gross_item_amount) AS gross_sales,
        SUM(discount_amount) AS total_discount,
        SUM(net_item_amount) AS net_sales
    FROM order_enriched
    GROUP BY 1, 2, 3
),

category_ranked AS (
    SELECT
        cms.*,
        RANK() OVER (
            PARTITION BY order_month
            ORDER BY net_sales DESC
        ) AS category_rank_in_month
    FROM category_monthly_sales cms
),

member_monthly_orders AS (
    SELECT
        member_id,
        order_month,
        COUNT(DISTINCT order_id) AS monthly_order_cnt,
        SUM(net_item_amount) AS monthly_sales
    FROM order_enriched
    GROUP BY 1, 2
),

member_monthly_with_prev AS (
    SELECT
        member_id,
        order_month,
        monthly_order_cnt,
        monthly_sales,
        LAG(monthly_sales) OVER (
            PARTITION BY member_id
            ORDER BY order_month
        ) AS prev_month_sales
    FROM member_monthly_orders
),

high_value_members AS (
    SELECT
        mos.member_id,
        mos.order_cnt,
        mos.total_net_sales,
        mos.avg_item_sales,
        mos.median_item_sales,
        mos.first_order_dt,
        mos.last_order_dt,
        CASE
            WHEN mos.total_net_sales >= 1000000 THEN 'VIP'
            WHEN mos.total_net_sales >= 300000 THEN 'GOLD'
            WHEN mos.total_net_sales >= 100000 THEN 'SILVER'
            ELSE 'NORMAL'
        END AS member_value_tier
    FROM member_order_stats mos
),

final_agg AS (
    SELECT
        oe.order_month,
        oe.channel_cd,
        oe.pay_method,
        oe.age_band,
        oe.gender,
        oe.grade_cd,
        oe.region_cd,
        hvm.member_value_tier,
        cr.category_rank_in_month,
        oe.category_id,
        oe.category_name,
        COUNT(DISTINCT oe.order_id) AS order_cnt,
        COUNT(DISTINCT oe.member_id) AS buyer_cnt,
        SUM(oe.quantity) AS item_qty,
        SUM(oe.gross_item_amount) AS gross_sales,
        SUM(oe.discount_amount) AS discount_amount,
        SUM(oe.net_item_amount) AS net_sales,
        AVG(oe.net_item_amount) AS avg_item_sales,
        COUNT(DISTINCT CASE WHEN oe.coupon_id IS NOT NULL THEN oe.order_id END) AS coupon_order_cnt,
        COUNT(DISTINCT CASE WHEN ts.sessions > 0 THEN oe.member_id END) AS traffic_member_cnt,
        SUM(COALESCE(ts.page_views, 0)) AS total_page_views,
        SUM(COALESCE(ts.add_to_cart_cnt, 0)) AS total_add_to_cart,
        SUM(COALESCE(ts.purchase_click_cnt, 0)) AS total_purchase_click,
        AVG(COALESCE(mwp.prev_month_sales, 0)) AS avg_prev_month_member_sales
    FROM order_enriched oe
    LEFT JOIN high_value_members hvm
        ON oe.member_id = hvm.member_id
    LEFT JOIN category_ranked cr
        ON oe.order_month = cr.order_month
       AND oe.category_id = cr.category_id
    LEFT JOIN traffic_summary ts
        ON oe.member_id = ts.member_id
       AND oe.order_month = ts.event_month
    LEFT JOIN member_monthly_with_prev mwp
        ON oe.member_id = mwp.member_id
       AND oe.order_month = mwp.order_month
    GROUP BY
        oe.order_month,
        oe.channel_cd,
        oe.pay_method,
        oe.age_band,
        oe.gender,
        oe.grade_cd,
        oe.region_cd,
        hvm.member_value_tier,
        cr.category_rank_in_month,
        oe.category_id,
        oe.category_name
)

SELECT
    order_month,
    channel_cd,
    pay_method,
    age_band,
    gender,
    grade_cd,
    region_cd,
    member_value_tier,
    category_rank_in_month,
    category_id,
    category_name,
    order_cnt,
    buyer_cnt,
    item_qty,
    gross_sales,
    discount_amount,
    net_sales,
    avg_item_sales,
    coupon_order_cnt,
    traffic_member_cnt,
    total_page_views,
    total_add_to_cart,
    total_purchase_click,
    avg_prev_month_member_sales,
    CASE
        WHEN buyer_cnt > 0 THEN net_sales / buyer_cnt
        ELSE 0
    END AS arpu,
    CASE
        WHEN total_page_views > 0 THEN CAST(order_cnt AS double) / total_page_views
        ELSE 0
    END AS order_per_pageview
FROM final_agg
WHERE category_rank_in_month <= 10
ORDER BY order_month, net_sales DESC;
