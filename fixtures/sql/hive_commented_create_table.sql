-- #------------------------------------------------------------------------------#
-- # DDL
-- #------------------------------------------------------------------------------#
CREATE TABLE IF NOT EXISTS 11ST.{{ params.table_prefix }}BASE_11ST_AUTO_PAGE_STP_LOG
(
  LOG_SEQ STRING COMMENT '로그순번',
  CRTRN_DTTM_MS STRING COMMENT '기준일시밀리초'
)
COMMENT '기초_자동화 페이지 단계별 로그'
PARTITIONED BY (PART_DT STRING)
STORED AS ORC
LOCATION 'hdfs://11stnds/data_bis/11st/{{ params.table_path_prefix }}base_11st_auto_page_stp_log'
TBLPROPERTIES ("orc.compress"="NONE");
