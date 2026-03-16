CREATE EXTERNAL TABLE IF NOT EXISTS 11ST.{{ params.table_prefix }}BASE_11ST_AUTO_CLIENT_LOG
(
  CRTRN_DTTM_MS STRING COMMENT '기준일시밀리초'
)
COMMENT '기초_자동화 CLIENT 로그'
PARTITIONED BY (PART_DT STRING)
STORED AS ORC
LOCATION 'hdfs://11stnds/data_bis/11st/{{ params.table_path_prefix }}base_11st_auto_client_log'
TBLPROPERTIES ("orc.compress"="ZLIB");
