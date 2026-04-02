CREATE EXTERNAL TABLE IF NOT EXISTS APPDATA.{{ params.table_prefix }}BASE_APP_CLIENT_LOG
(
  CRTRN_DTTM_MS STRING COMMENT '기준일시밀리초'
)
COMMENT '기초_자동화 CLIENT 로그'
PARTITIONED BY (PART_DT STRING)
STORED AS ORC
LOCATION 'hdfs://warehouse/data/example/{{ params.table_path_prefix }}base_app_client_log'
TBLPROPERTIES ("orc.compress"="ZLIB");
