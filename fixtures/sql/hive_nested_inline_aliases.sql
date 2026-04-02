CREATE TABLE APPDATA.{{ params.table_prefix }}TMP_BASE_APP_CLIENT_LOG_${YYYYMMDD}
AS
SELECT X.*
FROM (
      SELECT B.*,
             COALESCE(PARSE_URL(COALESCE(AD.ADS_URL, B.LINK_URL), 'PATH'), '') AS LINK_URL_VERIFY_PATH,
             COALESCE(AD.ADS_URL, B.LINK_URL, '') AS LINK_URL_VERIFY
      FROM (
            SELECT A.*,
                   PARSE_URL(A.LINK_URL,'QUERY','ads_id') AS ADS_ID,
                   PARSE_URL(A.LINK_URL,'QUERY','creative_id') AS CREATIVE_ID,
                   PARSE_URL(A.LINK_URL,'QUERY','click_id') AS CLICK_ID
            FROM (
                  SELECT
                    S.*,
                    IF(
                        COALESCE(REGEXP_EXTRACT(S.TMP_LINK_URL,'redirect\\=(.+)',1),'') != '',
                        REGEXP_REPLACE(REGEXP_EXTRACT(S.TMP_LINK_URL,'redirect\\=(.+)',1),'^\\/\\/','https://'),
                        S.TMP_LINK_URL
                    ) AS LINK_URL
                  FROM (
                        SELECT *,
                               COALESCE(
                                 REGEXP_REPLACE(
                                   REFLECT("java.net.URLDecoder", "decode", COALESCE(GET_JSON_OBJECT(LNKG_LOG_BODY, '$.link_url'),"")),
                                   '\\r|\\n|\\u0001|\\\\r|\\\\n|\\\\u0001|\\\\\\\\r|\\\\\\\\n|\\\\\\\\u0001',
                                   ''
                                 ),
                                 ''
                               ) AS TMP_LINK_URL
                        FROM APPDATA.{{ params.table_prefix }}BASE_APP_MID_LOG
                        WHERE PART_DT = '${YYYYMMDD}'
                  ) AS S
            ) AS A
      ) AS B
      LEFT JOIN (
        SELECT
            ADS_ID,
            CREATIVE_ID,
            CLICK_ID,
            ADS_URL
        FROM DIMDATA.{{ params.table_prefix }}DIM_AD_LINK_MAP
        WHERE PART_DT = '20260107'
      ) AS AD
      ON B.ADS_ID = AD.ADS_ID
        AND B.CREATIVE_ID = AD.CREATIVE_ID
        AND B.CLICK_ID = AD.CLICK_ID
     ) AS X
;
