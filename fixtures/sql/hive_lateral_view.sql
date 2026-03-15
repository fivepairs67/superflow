SELECT
    pageid,
    adid,
    ad_type
FROM pageAds
LATERAL VIEW explode(adid_list) exploded AS adid
LATERAL VIEW explode(ad_type_list) typed AS ad_type
WHERE pageid = 'front_page';
