# SuperFLOW

복잡한 SQL, 이제 흐름으로 이해하세요.

SuperFLOW는 웹 기반 SQL 에디터를 위한 SQL 흐름 및 lineage 시각화 도구입니다. 데이터 분석가, 분석 엔지니어, 그리고 SQL을 다루는 사람들이 레거시 쿼리를 더 빠르게 이해하고, 의존성을 시각적으로 추적하며, 복잡한 SQL을 더 자신 있게 수정할 수 있도록 돕습니다.

언어:
- English: [README.md](./README.md)
- Korean: `README.ko.md`

## 제품 정체성

SuperFLOW는 단순한 Superset 전용 부가기능이 아닙니다.

이 프로젝트는 다음 세 층으로 동작하는 SQL 이해 도구입니다.
- Superset SQL Lab에서 가장 깊게 통합되는 모드
- 다른 웹 기반 SQL 에디터에서 동작하는 read-first 모드
- 직접 읽기 어려운 환경에서도 쓸 수 있는 Clipboard / Paste fallback

가장 강력한 경험은 Superset SQL Lab에서 제공합니다.

## 설치하고 시작하기

[Chrome 웹 스토어에서 SuperFLOW 설치](https://chromewebstore.google.com/detail/superflow/jndkmgobfdidhgcmkakkdjdgamchgbij) 후 도구 모음에 고정하면 편리합니다. 스토어 버전은 개발자 모드를 켤 필요가 없습니다.

1. SQL 편집기가 있는 탭에서 SuperFLOW 버튼을 누릅니다.
2. `Enable Site`로 해당 사이트 접근을 허용하고, 그래프 노드를 눌러 SQL과 컬럼을 살펴봅니다.
3. 자동 수집이 안 되면 `Paste SQL`에 붙여넣고 `Analyze paste`를 누릅니다. 붙여넣기에는 사이트 접근 권한이 필요하지 않습니다.

SQL 분석은 브라우저 안에서 처리하며 개발자 서버나 AI 서비스로 SQL을 보내지 않습니다. SQL 실행이나 데이터베이스 접속도 하지 않습니다. 자세한 내용은 [개인정보처리방침](./PRIVACY.md)을 참고하세요.

## 어떤 이점이 있나

- 길고 복잡한 SQL을 source, CTE, join, filter, subquery, output 흐름으로 파악할 수 있습니다.
- 레거시 SQL을 한 줄씩 읽는 대신 더 빠르게 구조적으로 이해할 수 있습니다.
- 수정 전에 upstream/downstream 의존 관계를 추적할 수 있습니다.
- 컬럼 lineage를 확인하고 SQL 텍스트와 그래프를 오가며 탐색할 수 있습니다.
- multi-statement worksheet를 logical graph와 script dependency graph 두 관점에서 볼 수 있습니다.

## 핵심 기능

- source, CTE, join, filter, aggregate, subquery, output, write target을 logical graph로 시각화
- multi-statement worksheet를 위한 script view와 statement dependency 추적
- upstream reference가 붙는 column lineage
- Superset SQL Lab에서의 양방향 포커싱
- editor selection을 따라가는 graph focus
- 직접 읽기 어려운 환경을 위한 Clipboard / Paste fallback
- Trino, Hive, PostgreSQL 중심 파싱 + heuristic fallback

## 어디서 가장 잘 동작하나

- `Superset SQL Lab`
  가장 강한 모드입니다. editor focus를 그래프로 따라가고, 그래프 focus를 다시 editor로 밀어넣고, worksheet 구조를 더 정확히 읽으며, schema panel 같은 SQL Lab 전용 레이아웃까지 제어할 수 있습니다.
- `그 외 웹 기반 SQL 에디터`
  Bitbucket SQL 파일 화면과 OneCompiler 등을 best-effort로 지원합니다. 사이트가 편집기 상태를 노출하는 방식에 따라 수집과 포커싱 범위가 달라지며, 사이트나 편집기 버전이 바뀌면 동작이 달라질 수 있습니다.
- `Clipboard / Paste`
  가장 범용적인 fallback입니다. 사이트가 editor 상태를 잘 노출하지 않아도 SQL을 분석할 수 있습니다.

## 사이트 사용 방식

SuperFLOW는 현재 탭 중심으로 사용하는 제품입니다.

1. 분석하고 싶은 SQL 에디터 탭에서 도구 모음의 SuperFLOW 버튼을 누릅니다.
2. 아직 허용하지 않은 사이트라면 `Enable Site`를 한 번 클릭합니다.
3. 그 뒤에는 같은 사이트에서 추가 허용 없이 계속 사용할 수 있고, 헤더에는 `Site Access On` 상태가 표시됩니다.
4. 나중에 현재 사이트 접근을 끄고 싶다면 `Site Access On` 버튼을 다시 누르면 됩니다.
5. 사이트가 editor 상태를 충분히 노출하지 않는다면 `Clipboard` 또는 `Paste SQL`로 전환합니다.

패널은 버튼을 누른 탭에만 연결됩니다. 다른 탭이나 Chrome 창에서는 자동으로 열리지 않으며, 필요할 때 해당 탭에서 버튼을 누르면 됩니다. 사이트 접근 권한은 같은 사이트에서 공유하지만 SQL 분석 세션은 탭별로 분리됩니다.

즉 SuperFLOW는 모든 웹 기반 SQL 에디터에서 동일한 수준의 통합을 보장하지는 않습니다. 기준이 되는 경험은 Superset SQL Lab이고, 다른 사이트는 의도적으로 read-first, best-effort 계층으로 지원합니다.

## 왜 Superset SQL Lab에서 더 강한가

Superset SQL Lab에서는 단순 시각화보다 더 깊은 상호작용이 가능합니다.

- 그래프 노드와 editor 사이의 양방향 포커싱
- 현재 커서/선택 범위를 따라가는 selection-follow
- multi-statement worksheet에 더 강한 statement 인식
- schema panel 토글 같은 SQL Lab 전용 레이아웃 제어
- 더 풍부한 SQL snapshot과 page-context 감지

즉 Superset SQL Lab에서의 SuperFLOW는 단순 viewer라기보다, SQL을 읽고 수정하는 과정을 돕는 분석 보조 도구에 가깝습니다.

## 현재 모드

- `Superset mode`
  SQL Lab과 깊게 통합되며, 양방향 포커싱과 schema panel 제어까지 제공합니다.
- `Web editor mode`
  일반 웹 기반 SQL 에디터에서 read-first 방식으로 그래프를 제공합니다.
- `Clipboard / Paste mode`
  어떤 환경에서도 사용할 수 있는 범용 fallback입니다.

## 현재 상태

SuperFLOW는 강한 베타 단계의 MVP입니다.

현재 강점:
- logical graph / script view
- CTE, JOIN, subquery, write-target 그래프 모델링
- column lineage MVP
- Trino, Hive, PostgreSQL 중심 파싱 경로
- parser fixture 기반 회귀 검증
- side panel 탐색에 맞춘 compact UI

## 로컬 개발

```bash
npm install
npm run typecheck
npm run test:runtime
npm run test:parser-fixtures
npm run test:release
npm run build:extension
```

빌드 산출물:
- `dist/extension/`

안내:
- `dist/extension/`은 로컬에서 생성되는 산출물이고 GitHub에는 포함되지 않습니다.
- GitHub에서 repo를 clone한 경우 먼저 빌드를 실행해야 합니다.
- 그 다음 Chrome 확장 프로그램 개발자 모드에서 `dist/extension/` 폴더를 로드하면 됩니다.

## GitHub Release로 설치하기

1. 리포지토리의 Releases 페이지에서 최신 `superflow-extension-vX.Y.Z.zip` 파일을 다운로드합니다.
2. 압축을 해제합니다.
3. Chrome에서 `chrome://extensions`를 엽니다.
4. `개발자 모드`를 켭니다.
5. `압축해제된 확장 프로그램을 로드합니다`를 클릭합니다.
6. 압축 해제된 `superflow-extension-vX.Y.Z/` 폴더를 선택합니다.

## Release 아카이브 만들기

```bash
npm install
npm run build:release
```

생성 결과:
- `dist/release/superflow-extension-vX.Y.Z.zip`
- `dist/release/superflow-chrome-store-vX.Y.Z.zip`

첫 번째 ZIP은 GitHub Release 배포용, 두 번째 ZIP은 Chrome 웹 스토어 제출용입니다. 스토어용은 `manifest.json`이 압축파일 최상위에 위치합니다. 빌드 산출물과 ZIP은 Git에 커밋하지 않습니다.

## 문의와 한계

SuperFLOW는 SQL 이해를 돕는 베타 도구이며, 실행 계획이나 쿼리 정확성을 보장하는 검증기는 아닙니다. 지원하지 않는 문법은 휴리스틱 분석으로 전환될 수 있고, 스키마 정보가 없는 컬럼 lineage는 불완전할 수 있습니다. 수정 전 원문을 확인하세요.

문제는 [GitHub Issues](https://github.com/fivepairs67/superflow/issues)에 확장 버전, Chrome 버전, 사이트/편집기 종류, SQL 방언, 최소 재현용 가상 SQL과 함께 남겨주세요. 인증 정보, 회사 테이블명, 내부 주소, 기밀 SQL은 포함하지 마세요.

## 문서

- [작업 체크리스트](./TASKS.md)
- [GitHub 공개 체크리스트](./docs/GITHUB_RELEASE_CHECKLIST.md)
- [Chrome 웹 스토어 제출 안내](./docs/store/SUBMISSION.md)
- [설계 문서](./docs/DESIGN.md)
- [React 재설계](./docs/REACT_REDESIGN.md)
- [Column Lineage 계획](./docs/COLUMN_LINEAGE_PLAN.md)
- [SQL Fixture 목록](./fixtures/README.md)
- [개인정보처리방침](./PRIVACY.md)
