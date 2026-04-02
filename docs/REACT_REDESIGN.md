# Superset Query Visualizer React 재설계안

## 1. 목적

현재 확장 프로그램은 바닐라 JavaScript로도 동작한다. 하지만 앞으로 다음 요구가 늘어날 가능성이 높다.

- 노드 클릭 상세, breadcrumb, 선택 상태 유지
- lineage focus, filter, collapse, view mode 전환
- zoom, pan, minimap, hover preview
- SQL 텍스트와 그래프의 양방향 하이라이트
- 실행 상태와 그래프 상태를 함께 다루는 복합 UI

이 수준부터는 DOM 조작 중심 구조보다 React 기반 UI 계층이 유지보수와 확장성에서 유리하다.

이 문서의 목표는 "현재 Chrome Extension 구조를 유지하면서 side panel UI를 React 중심으로 재설계하는 기준안"을 정리하는 것이다.

## 2. 핵심 결정

### 2.1 React 적용 범위

React는 `side panel UI`에만 적용한다.

- React 적용
  - `sidepanel`
  - 이후 필요 시 `options page`
- React 미적용
  - `background service worker`
  - `content script`
  - `page bridge`
  - `parser worker`

이유:

- side panel은 상태와 상호작용이 많은 화면이다.
- background, content, bridge는 이벤트 수집과 메시지 중계가 핵심이라 React의 이점이 거의 없다.
- 크롬 익스텐션에서 React를 전체에 무리하게 확장하면 빌드 복잡도만 늘어난다.

### 2.2 재설계 목표

- side panel UI를 React 컴포넌트 기반으로 분리한다.
- 그래프, 실행 상태, SQL snapshot, diagnostics를 독립적인 상태 단위로 다룬다.
- 메시지 프로토콜은 유지하고 UI 계층만 교체할 수 있게 한다.
- 현재 heuristic 분석기와 메시지 수집 로직은 가능한 한 그대로 재사용한다.

### 2.3 비목표

- background/content/bridge를 React로 바꾸지 않는다.
- 1차 전환에서 AST 파서까지 함께 바꾸지 않는다.
- UI 프레임워크 전환과 분석 엔진 전환을 한 번에 묶지 않는다.

## 3. 권장 아키텍처

```text
Superset SQL Lab Page
  -> page bridge
  -> content script
  -> background service worker
  -> chrome.runtime messaging
  -> React side panel app
```

핵심은 `이벤트 수집 계층`과 `UI 계층`을 분리하는 것이다.

- 수집 계층
  - DOM 관찰
  - 네트워크 감지
  - SQL snapshot 수집
  - 세션 저장
- UI 계층
  - 현재 세션 구독
  - 그래프 렌더링
  - 선택 상태, 필터 상태, 뷰 상태 관리

## 4. 권장 디렉터리 구조

```text
superflow/
├── README.md
├── TASKS.md
├── docs/
│   ├── DESIGN.md
│   └── REACT_REDESIGN.md
├── extension/
│   ├── manifest.json
│   ├── sidepanel.html
│   ├── public/
│   │   └── icons/
│   └── src/
│       ├── background/
│       │   ├── index.ts
│       │   ├── session-store.ts
│       │   ├── analysis-service.ts
│       │   └── message-router.ts
│       ├── content/
│       │   ├── index.ts
│       │   ├── page-detection.ts
│       │   ├── sql-snapshot.ts
│       │   └── bridge-client.ts
│       ├── bridge/
│       │   ├── index.ts
│       │   ├── editor-observer.ts
│       │   └── network-observer.ts
│       ├── parser/
│       │   ├── worker.ts
│       │   ├── analyze-sql.ts
│       │   ├── graph-builder.ts
│       │   └── sql-fixtures/
│       ├── shared/
│       │   ├── types/
│       │   │   ├── session.ts
│       │   │   ├── graph.ts
│       │   │   └── messages.ts
│       │   ├── constants/
│       │   ├── utils/
│       │   └── runtime/
│       └── sidepanel/
│           ├── main.tsx
│           ├── App.tsx
│           ├── app/
│           │   ├── providers.tsx
│           │   └── layout.tsx
│           ├── state/
│           │   ├── session-store.ts
│           │   ├── graph-store.ts
│           │   ├── ui-store.ts
│           │   └── selectors.ts
│           ├── hooks/
│           │   ├── use-tab-session.ts
│           │   ├── use-runtime-port.ts
│           │   ├── use-graph-focus.ts
│           │   └── use-graph-viewport.ts
│           ├── components/
│           │   ├── shell/
│           │   │   ├── Header.tsx
│           │   │   ├── StatusChips.tsx
│           │   │   └── Section.tsx
│           │   ├── graph/
│           │   │   ├── GraphCanvas.tsx
│           │   │   ├── GraphNode.tsx
│           │   │   ├── GraphEdge.tsx
│           │   │   ├── GraphToolbar.tsx
│           │   │   ├── FlowLegend.tsx
│           │   │   └── FocusPanel.tsx
│           │   ├── execution/
│           │   │   ├── ExecutionSummary.tsx
│           │   │   └── EventTimeline.tsx
│           │   ├── sql/
│           │   │   ├── SqlSnapshot.tsx
│           │   │   └── SqlElementList.tsx
│           │   └── diagnostics/
│           │       └── DiagnosticsPanel.tsx
│           ├── features/
│           │   ├── graph/
│           │   │   ├── layout.ts
│           │   │   ├── lineage-colors.ts
│           │   │   └── graph-focus.ts
│           │   ├── execution/
│           │   └── sql/
│           └── styles/
│               ├── tokens.css
│               ├── base.css
│               ├── layout.css
│               └── graph.css
└── tools/
    └── build/
```

## 5. 계층별 책임

### 5.1 `shared/`

React 전환의 핵심은 타입과 메시지 계약을 먼저 공통화하는 것이다.

여기에 둬야 하는 것:

- `TabSession`
- `ExecutionState`
- `AnalysisResult`
- `GraphNode`, `GraphEdge`
- runtime message type
- 공통 format 함수

여기에 두면 안 되는 것:

- DOM 접근 코드
- React hook
- service worker 전용 로직

### 5.2 `background/`

역할:

- 탭 단위 세션 유지
- content script에서 들어온 상태 반영
- side panel에 최신 세션 푸시
- 분석 서비스 호출

React 전환 후에도 가장 적게 바뀌어야 하는 계층이다.

### 5.3 `content/` / `bridge/`

역할:

- Superset SQL Lab 감지
- SQL editor 내용 추출
- execute/results/estimate 이벤트 감지

이 계층은 "React와 무관한 데이터 수집기"로 유지한다.

### 5.4 `sidepanel/`

역할:

- React 앱 루트
- 세션 표시
- 그래프 상호작용
- UI 상태 관리

이 계층이 이번 재설계의 핵심이다.

## 6. React side panel 구성

### 6.1 최상위 컴포넌트 트리

```text
App
├── Header
├── StatusChips
├── LogicalGraphSection
│   ├── GraphToolbar
│   ├── GraphCanvas
│   ├── FlowLegend
│   └── FocusPanel
├── QueryElementsSection
├── ExecutionSection
├── SqlSnapshotSection
├── DiagnosticsSection
└── EventTraceSection
```

### 6.2 `GraphCanvas` 내부 책임

`GraphCanvas`는 렌더만 담당한다.

- 노드/엣지 SVG 렌더
- 클릭/hover 이벤트 전달
- viewport transform 적용

여기서 하지 말아야 할 것:

- runtime 메시지 호출
- 세션 저장
- SQL 분석 실행

### 6.3 `FocusPanel`

선택된 노드 기준으로 다음을 보여준다.

- node label
- node type
- upstream lineage 목록
- downstream lineage 목록
- 관련 source 수
- 관련 CTE 수

### 6.4 `GraphToolbar`

여기에 들어갈 기능:

- fit view
- reset selection
- view mode 전환
- collapse all / expand all
- color mode 전환

## 7. 상태 구조

React 전환 후에는 상태를 다음 3개 슬라이스로 나누는 편이 안정적이다.

### 7.1 `session-store`

수집된 원본 세션 상태

- URL
- SQL Lab 감지 여부
- SQL snapshot
- execution 상태
- analysis 결과
- 이벤트 로그

이 상태는 background에서 온 최신 스냅샷을 그대로 반영한다.

### 7.2 `graph-store`

그래프 상호작용 상태

- selected node id
- hovered node id
- collapsed node ids
- highlighted lineage ids
- view mode
- color mode
- layout mode

### 7.3 `ui-store`

패널 표현 상태

- 열린 disclosure 섹션
- compact mode
- panel width class
- onboarding hint 노출 여부
- error banner 닫힘 상태

## 8. 데이터 흐름

```text
background -> runtime message -> session-store
session-store -> selectors -> React components
user interaction -> graph-store/ui-store
graph-store + session-store -> derived graph view model
derived graph view model -> GraphCanvas / FocusPanel
```

핵심은 `원본 세션`과 `파생 UI 상태`를 분리하는 것이다.

이렇게 해야 하는 이유:

- background에서 세션이 갱신되어도 선택 상태를 유지하기 쉽다.
- 그래프를 다시 그려도 UI 상태를 보존할 수 있다.
- 테스트가 쉬워진다.

## 9. 그래프 렌더링 전략

### 9.1 1차 권장안

현재의 custom SVG 렌더러를 React 컴포넌트로 이관한다.

이유:

- 이미 동작하는 레이아웃과 lineage 색 로직이 있다.
- 전환 비용이 낮다.
- React로 옮긴 뒤에도 SVG 기반 인터랙션은 충분히 가능하다.

### 9.2 2차 선택안

다음 기능이 실제로 필요해지면 그래프 라이브러리 도입을 검토한다.

- drag
- pan
- minimap
- 노드 접기/펼치기
- edge label
- 대형 그래프 가상화

즉, 1차는 `React + custom SVG`, 2차는 필요 시 그래프 라이브러리 검토가 맞다.

## 10. 메시지 프로토콜 설계

React side panel은 background와만 직접 통신한다.

권장 message 종류:

- `GET_TAB_SESSION`
- `TAB_SESSION_UPDATED`
- `REQUEST_REANALYZE`
- `SET_PANEL_PREFERENCE`
- `OPEN_SQL_RANGE`

중요 원칙:

- side panel이 content script에 직접 의존하지 않는다.
- background가 유일한 세션 소유자 역할을 한다.

## 11. 파일 전환 기준

### 11.1 그대로 유지할 파일

- `background.js`
- `content.js`
- `page-bridge.js`
- `sql-analysis.js`

이 파일들은 전환 초기에는 TypeScript로만 옮기고 책임은 유지한다.

### 11.2 React로 교체할 파일

- `sidepanel.html`
- `sidepanel.js`
- `sidepanel.css`

이 3개는 결국 `React entry + component styles` 구조로 흡수된다.

## 12. 마이그레이션 순서

### Step 1. 빌드 기반 추가

- TypeScript 설정 추가
- side panel React entry 추가
- extension 다중 entry 빌드 구성 추가
- 기존 side panel은 유지한 채 병행 빌드 가능하게 만든다

완료 기준:

- React로 만든 빈 side panel이 확장에서 열린다.

### Step 2. 세션 구독 계층 이관

- `GET_TAB_SESSION`
- `TAB_SESSION_UPDATED`
- runtime port hook
- `session-store`

완료 기준:

- 기존 텍스트 정보가 React UI에 동일하게 표시된다.

### Step 3. 그래프 렌더러 이관

- 기존 layout 함수 이동
- lineage color 로직 이동
- SVG node/edge 렌더를 React 컴포넌트화

완료 기준:

- 현재 그래프가 React side panel에서 동일하게 보인다.

### Step 4. 상호작용 상태 이관

- selected node
- focus panel
- reset selection
- hover state

완료 기준:

- 현재 노드 클릭 기반 상호작용이 React로 동일하게 동작한다.

### Step 5. React 전용 UX 강화

- zoom/pan
- collapse/expand
- SQL 양방향 하이라이트
- keyboard navigation

완료 기준:

- 바닐라 구조로 다루기 어려운 상호작용이 React 구조에서 안정적으로 동작한다.

## 13. 테스트 전략

React 전환 후 테스트는 최소 세 층으로 나눈다.

- 순수 함수 테스트
  - layout
  - lineage color
  - selector
- 컴포넌트 테스트
  - GraphCanvas
  - FocusPanel
  - ExecutionSummary
- 통합 테스트
  - session update -> UI 반영
  - node click -> focus panel 반영

## 14. 리스크와 대응

### 14.1 빌드 복잡도 증가

대응:

- React는 side panel에만 제한
- background/content/bridge는 독립 entry 유지

### 14.2 메시지 구조가 컴포넌트에 새어 나감

대응:

- runtime 통신은 `hooks/` 또는 `shared/runtime/`로 감싼다
- 컴포넌트는 세션 selector만 읽게 한다

### 14.3 그래프 성능 저하

대응:

- 1차는 custom SVG 유지
- 파생 모델 계산은 selector 또는 memoized function으로 분리

## 15. 최종 권장안

이 프로젝트는 "전체를 React로 재작성"하는 것보다 아래 방향이 가장 실용적이다.

1. side panel만 React + TypeScript로 전환한다.
2. background/content/bridge/analyzer는 독립 모듈로 유지한다.
3. 현재 custom SVG 그래프를 먼저 React로 감싼다.
4. 그 다음 zoom, collapse, SQL 하이라이트 같은 진짜 고급 UX를 추가한다.

즉, 재설계의 본질은 프레임워크 교체가 아니라 `UI 상태 관리 계층을 분리해서 복잡한 인터랙션을 받을 준비를 하는 것`이다.
