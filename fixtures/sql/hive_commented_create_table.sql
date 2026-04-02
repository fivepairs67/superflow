-- #------------------------------------------------------------------------------#
-- # DDL
-- #------------------------------------------------------------------------------#
CREATE TABLE IF NOT EXISTS APPDATA.{{ params.table_prefix }}BASE_APP_PAGE_STEP_LOG
(
  LOG_SEQ STRING COMMENT '로그순번',
  CRTRN_DTTM_MS STRING COMMENT '기준일시밀리초'
)
COMMENT '기초_자동화 페이지 단계별 로그'
PARTITIONED BY (PART_DT STRING)
STORED AS ORC
LOCATION 'hdfs://warehouse/data/example/{{ params.table_path_prefix }}base_app_page_step_log'
TBLPROPERTIES ("orc.compress"="NONE");
