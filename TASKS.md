# Superset Query Visualizer 작업 체크리스트

프로젝트의 작업 순서와 완료 여부를 한 파일에서 관리하기 위한 체크리스트입니다.

## 사용 규칙

- `[x]` 완료
- `[ ]` 미완료
- 작업은 위에서 아래 순서로 진행하는 것을 기본으로 합니다.
- 하위 항목이 모두 끝나면 상위 항목을 체크합니다.

## 현재 상태 요약

- 현재 단계: React side panel 기반 multi-statement worksheet + Script View + zoom/pan/folded logical graph + AST 보강 분석 + write target graph 확장 + subquery/inline view / UNION branch graph 확장 1차 + editor/snapshot highlight + column lineage MVP 1차 + SuperFLOW 브랜딩/compact worksheet UI + global English copy + lineage-first color system 보정 + dialect auto/manual override + parser status UI + Manual paste / Clipboard fallback + Hive/Trino `dt-sql-parser` 안전 통합 + parser fixture 회귀 테스트 2차 + SQL Lab schema panel toggle 안정화 1차 + script/logical edge semantics 정리 + script first-click focus / second-click open 인터랙션 정비 + selected-node focus polish + HAVING / MERGE MATCH-ON / RETURNING / ON CONFLICT target-action 분리 / OFFSET clause graph 고도화 + QUALIFY / UNNEST / LATERAL VIEW / set-op label graph 고도화 + compact source/CTE sibling folding 1차 + folded cluster detail 보강 + recursive CTE / ROLLUP-CUBE-GROUPING SETS / INSERT VALUES / TABLESAMPLE source-meta / local wildcard expansion / dt-column fallback / dt-trino nested subquery 고도화 단계
- 마지막 갱신: `dt/trino` 경로에 heuristic nested subquery extraction을 추가하고, `WITH` 시작부 및 `FROM <cte>` reference selection-follow 포커싱을 보정해 fixture 32개 회귀를 유지
- 현재 강점: 워크시트 분리, 그래프 탐색, 컬럼 lineage, SQL Lab editor highlight, dialect auto/manual override, parser fallback 이유 표시, manual paste/clipboard fallback, Hive/Trino parser 확장 여지 확보, fixture 기반 회귀 검증 32개 확보, nested subquery / inline view / EXISTS / UNION branch를 그래프에서 분리해 볼 수 있는 기반 확보, DISTINCT / JOIN / SET / QUALIFY / VALUES / RETURNING / ON CONFLICT / OFFSET clause도 AST path에서 더 직접적으로 표현 가능하고 upsert는 conflict target과 action을 분리해 읽을 수 있음, sampled read는 source metadata로 구분 가능, HAVING은 post-aggregate filter로, MERGE는 `MATCH ON -> WHEN MATCHED/WHEN NOT MATCHED -> action` 흐름까지 더 직접적으로 읽을 수 있고 matched/not-matched path를 UPDATE/INSERT/DELETE action 기준으로 세밀하게 시각화 가능, UPDATE ... FROM / DELETE ... USING의 source flow까지 AST 경로에서 더 일관되게 표현 가능, Trino UNNEST와 Hive LATERAL VIEW를 derived source로 분리할 수 있고 set-op는 UNION/INTERSECT/EXCEPT 실제 라벨로 노출 가능, recursive CTE와 GROUP BY ROLLUP/CUBE/GROUPING SETS도 그래프/flow/meta에서 구분 가능, compact mode에서 clause stack뿐 아니라 sibling source/CTE를 cluster로 접어 대형 그래프의 세로 길이를 줄일 수 있고 folded members도 detail panel에서 확인 가능, local wildcard expansion으로 `cte_alias.*`와 all-known-source `*`가 pseudo-column이 아니라 실제 graph column으로 펼쳐지고 highlight span도 select item 기준으로 유지됨, `dt` parser 경로에서도 output column fallback과 heuristic nested subquery extraction이 생겨 manual Trino/Hive에서도 column panel이 비지 않고 `inline view / EXISTS / IN / scalar subquery` node를 유지할 수 있음, Superset SQL Lab 전용 UI 토글 안정화 1차 완료, Script View에서 흐름 포커스 후 logical drill-in 가능, logical graph에서 source flow / nested query / write target 의미가 더 직접적으로 정리됨, `WITH` 시작부와 CTE reference에서도 selection-follow 포커싱이 더 자연스럽게 동작하고, zoom out 상태에서도 selected-node focus가 더 잘 보이도록 halo / pulse 기반 강조 확보
- 현재 핵심 리스크: AST coverage 추가 확대 필요, schema-assisted wildcard expansion 미완료, generic editor UX 실환경 검증 미완료, palette/lineage 시각 언어 최종 튜닝 미완료

## 현재 우선순위

- [ ] AST -> logical graph 고도화를 더 진행해 heuristic 의존 줄이기
- [ ] parser fixture 범위를 Hive/Trino/PostgreSQL 실사용 샘플 기준으로 계속 확장
- [ ] lineage-first color system refinement
- [ ] span 계산 잔여 edge case 보정
- [ ] schema metadata 기반 wildcard expansion 전략 결정
- [ ] 대표 쿼리 5개 이상에서 그래프 생성 확인

## Phase 0. 프로젝트 기초

- [x] 프로젝트 폴더 생성
- [x] 프로젝트 개요 `README.md` 작성
- [x] 상세 설계 문서 `docs/DESIGN.md` 작성
- [x] 구현용 디렉터리 구조 생성
- [x] 기술 스택 최종 확정
- [ ] 초기 개발 규칙 정리

## Phase 1. Chrome Extension 셸

- [x] `extension/manifest.json` 초안 작성
- [x] background service worker 셸 생성
- [x] side panel 페이지 셸 생성
- [x] content script 셸 생성
- [x] page bridge 주입 구조 생성
- [x] 개발 빌드 환경 구성
- [x] 로컬 로드 가능한 최소 익스텐션 실행 확인

완료 기준:
Chrome에서 확장 로드 후 Superset 페이지에서 side panel이 열리고 기본 UI가 보인다.

## Phase 2. Superset 페이지 감지와 SQL 수집

- [ ] Superset origin 설정 방식 정의
- [x] SQL Lab 페이지 감지 로직 구현
- [x] SQL 에디터 탐지 로직 구현
- [x] 현재 SQL 스냅샷 수집 구현
- [x] 편집 변화 debounce 처리 구현
- [x] 탭 단위 세션 상태 저장 구현
- [x] SQL 문자열을 side panel에 실시간 표시

완료 기준:
SQL Lab에서 작성 중인 SQL이 side panel에 안정적으로 반영된다.

## Phase 3. SQL 분석 파이프라인 MVP

- [x] SQL 전처리 모듈 구현
- [x] Jinja placeholder 치환 전략 구현
- [x] parser 어댑터 1차 선정 및 연결
- [x] dialect auto-detect / manual override 초안 구현
- [x] nested subquery / inline view / EXISTS graph node 1차 확장
- [x] `dt/trino` heuristic nested subquery extraction (`inline view / EXISTS / IN / scalar`) 보강
- [ ] AST -> logical graph 변환기 구현 고도화
- [x] parse 실패 시 partial fallback 구현
- [x] multi-statement splitter 초안 구현
- [x] statement 간 read/write dependency 초안 구현
- [x] 샘플 SQL fixture 수집
- [ ] 대표 쿼리 5개 이상에서 그래프 생성 확인

완료 기준:
CTE, JOIN, FILTER, GROUP BY가 포함된 복잡한 SQL을 논리 그래프로 변환할 수 있다.

## Phase 4. 그래프 UI

- [x] 그래프 라이브러리 선정 확정
- [x] 노드/엣지 스키마 구현
- [x] 기본 DAG 레이아웃 구현
- [x] 노드 클릭 lineage focus 구현
- [x] 노드 상세 패널 구현
- [x] 확대/이동/선택 인터랙션 구현
- [x] 대형 그래프 접기/펼치기 초안 구현
- [x] worksheet selector compact pill UI 구현
- [x] 그래프 toolbar compact layout 구현
- [x] multi-source lineage stripe 시각화 구현
- [x] palette preset 전환 UI 구현
- [x] edge line legend 구현
- [x] Script View 첫 클릭 focus / 두 번째 클릭 logical open 구현
- [x] logical/script edge semantics 재정의
- [x] Script View main dependency edge 실선화
- [ ] lineage-first color system refinement
- [x] parser 상태 배지 및 오류 UI 구현
- [x] statement dependency `Script View` 구현

완료 기준:
사용자가 그래프를 탐색하며 구조를 시각적으로 이해할 수 있다.

## Phase 5. SQL 텍스트와 그래프 연결

- [x] SQL span 정보 보존 로직 구현
- [x] 노드 클릭 시 SQL 범위 하이라이트 구현
- [x] SQL 선택 시 대응 노드 강조 구현
- [x] side panel 선택 -> SQL Lab editor highlight bridge 구현
- [x] 현재 선택 상태 동기화 구현
- [x] editor highlight loop / scroll jump guard 구현
- [x] statement boundary overlap/clamp 기반 selection range 보정
- [x] `WITH` 시작부 / `FROM <cte>` reference selection-follow 포커싱 보정
- [ ] span 계산 잔여 edge case 보정

완료 기준:
텍스트와 그래프가 양방향으로 연결되어 탐색 가능하다.

## Phase 6. 실행 메타데이터 연동

- [x] 실행 시작 이벤트 감지
- [x] estimate 요청 감지
- [x] 결과 polling 또는 결과 fetch 감지
- [x] 상태, duration, row count 수집
- [x] 실행 요약 카드 UI 구현
- [x] 실패/취소 상태 표시 구현

완료 기준:
쿼리 실행 이후 상태와 요약 메타데이터를 side panel에서 확인할 수 있다.

## Phase 6A. Superset Layout Controls

- [x] Superset SQL Lab 전용 schema panel hide/show 토글 UI 초안 구현
- [x] origin 단위 schema panel preference 저장 초안 구현
- [x] 내부 SQL Lab 탭 전환 시 schema panel hide/show 안정화
- [ ] Superset 버전별 좌측 패널 DOM selector 보강

완료 기준:
같은 Superset origin의 SQL Lab 탭 어디서든 좌측 Database/Schema/Table 패널을 일관되게 숨기고 다시 복원할 수 있다.

## Phase 7. 안정화

- [x] parser fixture 테스트 작성
- [x] parser fixture coverage 2차 확대
- [x] QUALIFY / UNNEST / LATERAL VIEW / set-op fixture 확대
- [x] compact source/CTE sibling folding 1차 구현
- [x] folded cluster detail panel 보강
- [ ] content script 통합 테스트 작성
- [ ] side panel 상태 관리 테스트 작성
- [x] 실제 Superset 환경 수동 검증
- [ ] 성능 측정 및 debounce 튜닝
- [ ] 오류 메시지 정리
- [ ] 권한 범위 최소화 점검
- [ ] compact execution meta 유지 여부 결정 후 네트워크 이벤트 정규화 필요성 재평가
- [ ] `dt-sql-parser` shim duplicate-case warning 정리

완료 기준:
주요 플로우가 재현 가능하고, 실패 시에도 원인을 파악할 수 있다.

## Phase 8. 선택 기능

- [ ] rendered SQL 확보 전략 검토
- [ ] optional helper 구조 설계 구체화
- [ ] DB별 `EXPLAIN` 연동 방식 결정
- [ ] 비용/스캔량 오버레이 설계
- [ ] native Superset extension 전환 가능성 검토

완료 기준:
브라우저 단독 MVP 이후 고도화 방향이 명확해진다.

## Phase C. Column Lineage 확장

- [x] column lineage 설계 문서 `docs/COLUMN_LINEAGE_PLAN.md` 작성
- [x] 공통 column lineage 타입 초안 정의
- [x] select item / output column 추출기 초안 구현
- [x] node detail에 column list MVP 연결
- [x] compact source-grouped column panel 구현
- [x] column click -> SQL span highlight 연결
- [x] column selection -> node/source upstream focus 연결
- [x] wildcard (`*`, `table.*`) pseudo-column 처리
- [x] local wildcard expansion (`cte_alias.*`, all-known-source `*`)
- [ ] schema metadata 기반 wildcard expansion 전략 결정

완료 기준:
선택한 node 안에서 컬럼 목록과 컬럼 흐름을 확인할 수 있다.

## Phase R. React 전환

- [x] React 재설계 문서 `docs/REACT_REDESIGN.md` 작성
- [x] React 전환 범위를 `side panel only`로 확정
- [x] `shared` 타입과 메시지 계약 파일 분리
- [x] TypeScript 기반 다중 entry 빌드 구성
- [x] React side panel entry 생성
- [x] 세션 구독 hook과 store 계층 생성
- [x] 기존 sidepanel UI를 React 컴포넌트로 이관
- [x] 기존 그래프 SVG 렌더러를 React 컴포넌트로 이관
- [x] lineage focus와 선택 상태를 React store로 이관
- [x] color mode 상태를 React store로 이관
- [x] statement 선택 상태를 React store로 이관
- [x] React 전환 후 실제 Superset 수동 검증

완료 기준:
React 기반 side panel이 현재 프로토타입 기능을 유지한 채 동작하고, 이후 고급 인터랙션을 수용할 수 있다.

## Phase U. 브랜딩 및 UI 정비

- [x] SuperFLOW 브랜딩 헤더 적용
- [x] PNG 기반 로고 asset 연결
- [x] SQL LAB On/Off 연결 배지 적용
- [x] 전체 안내 문구 English 기반으로 정리
- [x] 상단 status chip 영역 제거
- [x] structure / runtime / detail panel compact UI 1차 정비
- [x] `Structure / Query Elements` 섹션 제거
- [x] statement selector를 pill-only UI로 정리
- [x] dialect selector compact UI 적용
- [x] generic 입력 fallback (`Clipboard` / `Paste SQL`) 구현
- [x] captured SQL 고정 / page SQL 복귀 흐름 구현
- [x] selection 캡처 플로팅 칩 실험 후 제거
- [x] Input / Dialect compact utility strip 적용
- [x] zoom indicator compact UI 적용
- [x] Superset 기준 Runtime / Execution 섹션 제거 및 compact execution meta 반영
- [x] selected node halo / pulse focus 효과 적용
- [x] selected node non-scaling stroke 강조 보정
- [ ] 컬러셋과 lineage/type 시각 언어 최종 튜닝

완료 기준:
최소 side panel 폭에서도 주요 정보가 과밀하지 않고, 색과 레이아웃만으로 흐름과 상태를 빠르게 읽을 수 있다.

## 바로 다음 작업

- [ ] AST 기반 graph building 고도화 지속
- [ ] parser fixture coverage 확대
- [ ] lineage-first color system refinement
- [ ] span 계산 잔여 edge case 보정
- [ ] Script View에서 statement cluster/grouping 개선
- [ ] schema metadata 기반 wildcard expansion 전략 결정

## 다음 체크포인트

- [ ] GitHub 공개 전 [release checklist](./docs/GITHUB_RELEASE_CHECKLIST.md) 기준으로 최종 점검

- [ ] Trino/Hive/Oracle/PostgreSQL 샘플 각각 1개 이상에서 detected / parser / fallback 결과 확인
- [x] representative fixture 32개에서 parser regression 확인
- [x] 같은 Superset origin의 여러 SQL Lab 내부 탭에서 schema panel hide/show 일관성 확인
- [ ] 중첩 서브쿼리, 인라인 뷰, 스칼라 서브쿼리, EXISTS, window function 조합 쿼리에서 source/cte 흐름 점검
- [ ] wildcard `*` 확장 필요 케이스와 metadata 필요 케이스 분리
- [ ] non-Superset 페이지에서 `Clipboard / Paste SQL` 입력 fallback 수동 검증

## 메모

- 설계 기준 문서: `docs/DESIGN.md`
- React 전환 기준 문서: `docs/REACT_REDESIGN.md`
- column lineage 기준 문서: `docs/COLUMN_LINEAGE_PLAN.md`
- 구현 초안 위치: `extension/`
- 현재 검증 범위: 문법 검증 완료, 실제 Superset SQL Lab에서 SQL 감지/실행 상태/heuristic 요약 동작 확인, React 빌드/타입체크 통과
- 현재 React 패널 검증 범위: statement 분리 선택, Logical Graph 렌더링, lineage focus, 실행 요약, 새로 열린 패널에서 기존 탭 감지 경로 확인
- 분석 엔진 상태: AST 보강 + heuristic fallback 혼합 단계
- 구현 시작 후에는 각 Phase 완료 시 이 파일을 즉시 갱신한다.
