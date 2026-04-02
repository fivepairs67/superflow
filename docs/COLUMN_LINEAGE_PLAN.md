# Superset Query Visualizer Column Lineage 확장안

## 1. 목적

현재 프로토타입은 `statement / CTE / source / clause / result` 수준의 logical graph를 제공한다.
다음 단계 목표는 여기에 `column-level lineage`를 추가하는 것이다.

즉, 사용자는 다음 질문에도 답할 수 있어야 한다.

- 이 CTE가 어떤 컬럼들을 만들어내는가
- 특정 결과 컬럼은 어느 source 컬럼들에서 왔는가
- 컬럼 표현식은 SQL 텍스트의 어느 범위에 해당하는가
- 컬럼 선택 시 upstream / downstream 흐름은 어떻게 이어지는가

이 문서는 이 기능을 현재 Chrome extension + React side panel 구조 위에 어떻게 확장할지 정리한다.

## 2. 목표와 비목표

### 2.1 목표

- CTE, source table, result node에 `컬럼 목록`을 표시한다.
- 특정 컬럼 클릭 시 해당 컬럼의 upstream / downstream lineage를 강조한다.
- 컬럼과 SQL span을 연결해, 그래프와 SQL snapshot이 양방향 하이라이트되게 한다.
- `SELECT *`, alias, 계산식, window function, aggregate를 best-effort로 해석한다.
- 현재 logical graph를 유지한 채 `column mode`를 선택적으로 연다.

### 2.2 비목표

- 1차 단계에서 모든 dialect를 100% 정확하게 해석하지 않는다.
- cross-query, cross-dashboard lineage까지 바로 확장하지 않는다.
- DB metadata 없이 `SELECT *`를 완전하게 확장하는 것을 보장하지 않는다.
- physical execution plan 수준의 컬럼 흐름까지 다루지 않는다.

## 3. 사용자 경험

### 3.1 기본 원칙

- 기본 화면은 지금처럼 node-level logical graph다.
- column-level 정보는 `항상 전체 그래프에 표시`하지 않는다.
- 사용자가 특정 node를 선택했을 때만 column list와 column lineage를 연다.

이유:

- 전체 column graph는 매우 빠르게 복잡해진다.
- side panel 너비에서는 table-level과 column-level을 동시에 항상 펼치면 읽기 어렵다.
- on-demand drill-down이 실제 사용성에 더 맞다.

### 3.2 권장 UX 단계

#### A. Column List MVP

- node 클릭
- detail panel 또는 node 확장 영역에 컬럼 목록 표시
- 컬럼 row마다 source lineage summary 표시

예:

- `order_month <- date_trunc(order_dt)`
- `diff_score <- weighted_score, lag(weighted_score)`

#### B. Column Focus

- 컬럼 클릭 시:
  - 해당 컬럼 row 강조
  - upstream 컬럼만 강조
  - SQL snapshot에서 표현식 span 하이라이트

#### C. Column Graph Expand

- 선택된 node 안에서 컬럼 row를 렌더
- source column -> target column edge를 node 내부 또는 옆 오버레이에 그림

#### D. Schema-assisted Expansion

- `SELECT *`를 실제 스키마 기준으로 확장
- `information_schema.columns`, Superset metadata, 또는 optional helper를 사용

## 4. 확장 구조

현재 구조:

- `extension/sql-analysis.js`
  - statement / CTE / source / clause 분석
- `extension/src/sidepanel/components/graph/GraphCanvas.tsx`
  - logical graph 렌더
- `extension/src/sidepanel/components/sql/SqlSnapshot.tsx`
  - SQL snapshot + span highlight

확장 후 추가 책임:

- parser:
  - select item 단위 AST 추출
  - target column / source column dependency 계산
  - column span 계산
- side panel:
  - column list 렌더
  - column focus 상태 관리
  - column lineage edge overlay

## 5. 데이터 모델

공통 타입은 `extension/src/shared/types`에 추가하는 것을 권장한다.

### 5.1 핵심 타입 초안

```ts
export interface ColumnSpan {
  start: number;
  end: number;
}

export interface ColumnRef {
  sourceNodeId?: string;
  sourceColumnId?: string;
  sourceName?: string;
  columnName?: string;
  qualifier?: string;
}

export interface ColumnLineage {
  targetColumnId: string;
  upstream: ColumnRef[];
  expressionSql?: string;
  expressionType?: "direct" | "aggregate" | "window" | "case" | "function" | "star";
  spans?: ColumnSpan[];
  confidence?: "high" | "medium" | "low";
}

export interface GraphColumn {
  id: string;
  nodeId: string;
  name: string;
  label?: string;
  ordinal?: number;
  role?: "source" | "derived" | "aggregate" | "window" | "wildcard";
  spans?: ColumnSpan[];
  lineage?: ColumnLineage | null;
}
```

### 5.2 node 확장

`GraphNode.meta`만으로 계속 밀 수는 있지만, column 기능이 커지면 별도 구조가 낫다.

권장:

- `AnalysisStatement.columnsByNodeId`
- 또는 `QueryGraph.columns`

예:

```ts
export interface QueryGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  columns?: GraphColumn[];
}
```

## 6. 분석 단계

### 6.1 1단계: select item 추출

각 statement / CTE / subquery에서:

- target column alias
- 원본 표현식 SQL
- span
- 표현식 내부 column references

를 추출한다.

필수 대응:

- `col`
- `table.col`
- `expr AS alias`
- `sum(col) AS total`
- `lag(col) over (...)`
- `case when ... end`

### 6.2 2단계: scope 해석

컬럼 lineage는 table-level보다 scope 해석이 훨씬 중요하다.

필요한 정보:

- table alias -> source node
- CTE name -> cte node
- subquery alias -> derived node
- current select list scope

즉, `a.col`의 `a`가 무엇인지 정확히 알아야 한다.

### 6.3 3단계: target column 생성

각 select item에서:

- target column 이름
- target node
- expression type
- source refs

를 만든다.

예:

```sql
SELECT
  o.order_id,
  date_trunc('month', o.order_dt) AS order_month,
  SUM(amount) AS total_amount
FROM ...
```

결과:

- `order_id`
  - direct
  - upstream: `o.order_id`
- `order_month`
  - function
  - upstream: `o.order_dt`
- `total_amount`
  - aggregate
  - upstream: `amount`

### 6.4 4단계: node 연결

컬럼은 항상 어떤 node 아래에 속한다.

- source table column
- CTE output column
- main result column

즉, column lineage는 `node 내부 구조 + node 간 흐름` 위에 놓여야 한다.

### 6.5 5단계: span 보존

컬럼 기능의 핵심은 span이다.

반드시 보존해야 하는 span:

- select item 전체 범위
- alias 범위
- source reference 범위
- wildcard (`*`, `table.*`) 범위

이 span이 있어야:

- 컬럼 클릭 -> SQL 하이라이트
- SQL 선택 -> 컬럼 focus

가 안정적으로 동작한다.

## 7. `SELECT *` 처리 전략

`SELECT *`는 metadata 없이는 완전한 column expansion이 불가능하다.

따라서 3단계 전략이 현실적이다.

### 7.1 수준 1: wildcard 그대로 표시

- `*`
- `orders.*`

를 하나의 pseudo-column으로 표시한다.

장점:

- parser-only로 가능

단점:

- 실제 컬럼 lineage까지는 못 감

### 7.2 수준 2: cached schema 사용

가능한 경우:

- Superset dataset metadata
- `information_schema.columns`
- 이전 질의 캐시

를 이용해 `*`를 실제 컬럼 목록으로 확장한다.

### 7.3 수준 3: optional helper

복잡한 dialect 또는 metadata API 접근이 어려운 경우:

- backend helper
- dialect-aware parser service

로 확장한다.

## 8. UI 설계

### 8.1 최소 구현

`NodeDetailPanel`에 다음 추가:

- `Columns` 섹션
- 컬럼 row list
- 컬럼 row 클릭 시 focus

### 8.2 권장 컴포넌트 구조

```text
sidepanel/components/graph/
  GraphCanvas.tsx
  NodeDetailPanel.tsx
  ColumnList.tsx
  ColumnLineagePreview.tsx
```

또는 기능이 커지면:

```text
sidepanel/components/columns/
  ColumnList.tsx
  ColumnRow.tsx
  ColumnLineagePanel.tsx
  ColumnExpressionPreview.tsx
```

### 8.3 상호작용

- node 클릭 -> column list 표시
- column 클릭 -> 해당 column lineage만 강조
- graph 배경 클릭 -> column focus 해제
- SQL snapshot에서 표현식 선택 -> 해당 column focus

### 8.4 시각화 원칙

- 기본은 node-level graph 유지
- column은 `선택된 node`에서만 표시
- edge는 항상 전체 column graph를 다 그리지 말고, focus path만 그림

이유:

- 전체 column edge는 side panel에서 거의 읽을 수 없다.

## 9. SQLFlow 스타일과의 차이

SQLFlow 스타일의 완전한 table/column lineage UI는 가능하지만, 현재 프로젝트 조건에서는 그대로 복제하는 것보다 단계적 확장이 낫다.

추천 방향:

1. `logical graph` 유지
2. `node drill-down`으로 columns 노출
3. `column lineage focus` 추가
4. 필요 시 `column canvas mode` 추가

즉, 현재 제품의 정체성은 `SQL Lab 보조 분석기`이고, SQLFlow는 더 범용적인 lineage 도구에 가깝다.

## 10. 구현 단계 제안

### Phase C1. Column List MVP

- select item 파서 추가
- node detail에 column list 표시
- alias / expression preview 표시

완료 기준:

- CTE / result 노드에서 output columns를 볼 수 있다.

### Phase C2. Column Focus

- column click -> lineage highlight
- SQL snapshot span highlight
- selected column 상태 store 추가

완료 기준:

- 특정 컬럼의 upstream 흐름을 읽을 수 있다.

### Phase C3. Wildcard Expansion

- `*`, `table.*` pseudo-column 지원
- schema metadata 연동 초안

완료 기준:

- wildcard가 최소한 의미 있는 방식으로 표현된다.

### Phase C4. Column Canvas

- 선택 node 내부 column row 렌더
- source column -> target column edge overlay

완료 기준:

- 선택된 node에서 컬럼 흐름을 시각적으로 추적할 수 있다.

## 11. 위험과 대응

### 11.1 parser 정확도

문제:

- column lineage는 table lineage보다 훨씬 parser 민감하다.

대응:

- AST 우선
- fallback은 confidence 낮게 표시
- parser status badge 제공

### 11.2 side panel 복잡도

문제:

- column까지 펼치면 side panel이 과밀해질 수 있다.

대응:

- on-demand drill-down
- focus path만 렌더
- collapse / compact mode 유지

### 11.3 metadata dependency

문제:

- wildcard 확장은 schema 정보 없이는 한계가 있다.

대응:

- 1차는 pseudo-column
- 이후 schema metadata cache
- 최종적으로 optional helper

## 12. 바로 다음 권장 작업

1. `shared/types`에 column lineage 타입 추가
2. `sql-analysis.js`에 select item / output column 추출기 추가
3. `NodeDetailPanel`에 column list MVP 연결
4. `SqlSnapshot`과 column span 하이라이트 연결
5. wildcard expansion 전략을 별도 task로 분리

## 13. 관련 파일

- [README.md](../README.md)
- [DESIGN.md](./DESIGN.md)
- [REACT_REDESIGN.md](./REACT_REDESIGN.md)
- [TASKS.md](../TASKS.md)
- [sql-analysis.js](../extension/sql-analysis.js)
- [GraphCanvas.tsx](../extension/src/sidepanel/components/graph/GraphCanvas.tsx)
- [SqlSnapshot.tsx](../extension/src/sidepanel/components/sql/SqlSnapshot.tsx)
