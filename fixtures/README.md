# SQL Fixtures

대표 SQL 샘플과 parser fixture 후보를 모아두는 디렉터리입니다.

- `sql/eda_news_worksheet.sql`
  독립적인 EDA statement가 여러 개 섞인 worksheet
- `sql/cte_diff.sql`
  CTE 2단계와 window function이 있는 분석 query
- `sql/join_sentiment.sql`
  join, filter, order by, limit 조합
- `sql/ddl_workflow.sql`
  multi-statement write/read dependency가 있는 DDL workflow
- `sql/metadata_lookup.sql`
  information schema 조회와 count query
- `sql/hive_external_table.sql`
  Hive `CREATE EXTERNAL TABLE ... ROW FORMAT ... LOCATION ...` + select 조합
- `sql/postgres_subqueries.sql`
  중첩 서브쿼리, EXISTS, scalar subquery, CTE 조합
- `sql/trino_metrics.sql`
  Trino 함수 `count_if`, `approx_percentile`, `date_diff` 조합
- `sql/trino_nested_subqueries.sql`
  Trino `inline view`, `EXISTS`, `IN`, scalar subquery 회귀용 샘플
- `sql/hive_lateral_view.sql`
  Hive `LATERAL VIEW explode(...)` 패턴
- `sql/hive_insert_overwrite.sql`
  Hive `INSERT OVERWRITE TABLE ... SELECT ...` 패턴
- `sql/trino_ctas.sql`
  Trino `CREATE TABLE AS` + aggregate 함수 조합
- `sql/postgres_update_from.sql`
  PostgreSQL `UPDATE ... FROM (subquery)` 패턴
- `sql/postgres_delete_using.sql`
  PostgreSQL `DELETE ... USING ...` 패턴
- `sql/postgres_having_rollup.sql`
  PostgreSQL `GROUP BY ... HAVING ... ORDER BY ...` 패턴
- `sql/postgres_union_exists.sql`
  PostgreSQL `UNION ALL` + `EXISTS` 조합
- `sql/postgres_distinct_join.sql`
  PostgreSQL `SELECT DISTINCT` + `LEFT JOIN` + `ORDER BY` 조합
- `sql/trino_merge_into.sql`
  Trino `MERGE INTO ... WHEN MATCHED / WHEN NOT MATCHED ...` 패턴
- `sql/oracle_like_detection.sql`
  Oracle-like 함수/키워드 감지 회귀용 샘플
- `sql/trino_unnest_orders.sql`
  Trino `CROSS JOIN UNNEST(...)` source flow 패턴
- `sql/generic_qualify_window.sql`
  `QUALIFY` + window function post-window filter 패턴
- `sql/hive_lateral_view_explode.sql`
  Hive `LATERAL VIEW explode(...)` derived source 패턴
- `sql/postgres_intersect_simple.sql`
  PostgreSQL `INTERSECT` set-op label 회귀용 샘플
- `sql/postgres_recursive_cte.sql`
  PostgreSQL `WITH RECURSIVE` CTE 회귀용 샘플
- `sql/postgres_rollup_sales.sql`
  PostgreSQL `GROUP BY ROLLUP(...)` aggregate label 회귀용 샘플
- `sql/postgres_insert_values.sql`
  PostgreSQL `INSERT ... VALUES (...)` literal-row input flow 회귀용 샘플
- `sql/postgres_update_returning.sql`
  PostgreSQL `UPDATE ... RETURNING ...` write-output clause 회귀용 샘플
- `sql/postgres_insert_on_conflict.sql`
  PostgreSQL `INSERT ... ON CONFLICT ... DO UPDATE` upsert path 회귀용 샘플
- `sql/postgres_select_offset.sql`
  PostgreSQL `ORDER BY ... OFFSET ...` paging clause 회귀용 샘플
- `sql/postgres_tablesample_read.sql`
  PostgreSQL `TABLESAMPLE ... REPEATABLE` sampled source metadata 회귀용 샘플
- `sql/postgres_cte_star_expansion.sql`
  PostgreSQL `cte_alias.*` local wildcard expansion 회귀용 샘플
- `sql/trino_commerce_rollup.sql`
  Trino large CTE-chain commerce analytics query 회귀용 샘플
- `parser-fixtures.json`
  fixture별 기대 mode/source/write/graph node type을 검증하는 회귀 스펙

추가 규칙:

- fixture는 가능한 한 실제 Superset SQL Lab 사용 패턴을 반영한다.
- parser/graph 회귀 검증 시 이 파일들을 우선 사용한다.
