# SuperFLOW

## 요약

복잡한 SQL을 흐름과 컬럼 lineage로 시각화하세요. 웹 SQL 편집기 옆에서 CTE와 JOIN을 탐색합니다.

## 상세 설명

남이 짠 SQL, 이제 흐름으로 이해하세요.

SuperFLOW는 복잡한 SQL을 그래프로 펼쳐주는 Chrome 사이드패널 도구입니다. 긴 레거시 쿼리의 CTE, JOIN, 필터, 서브쿼리와 결과 흐름을 살펴보고, 컬럼이 어디서 왔는지 추적하세요.

- Logical Graph: 쿼리 구조와 테이블 간 흐름 시각화
- Script View: 여러 SQL 문장의 읽기/쓰기 의존 관계 탐색
- Column lineage: 결과 컬럼의 원본과 변환 흐름 확인
- SQL 포커스: 지원하는 편집기에서 그래프와 SQL 원문을 오가며 탐색
- Clipboard / Paste: 자동 수집이 어려운 사이트에서도 SQL 분석
- Trino, Hive, PostgreSQL 중심 분석

시작은 간단합니다.
1. SQL 편집기 탭에서 SuperFLOW 버튼을 누릅니다.
2. Enable Site로 해당 사이트 접근을 허용합니다.
3. 그래프 노드를 눌러 원문과 컬럼을 확인합니다. 수집이 안 되면 Paste SQL을 사용하세요.

Superset SQL Lab에서 가장 깊은 통합을 제공합니다. Bitbucket SQL 파일 화면과 OneCompiler 등은 best-effort 지원이며, 사이트와 편집기 구현에 따라 수집·포커싱 범위가 달라질 수 있습니다. 패널은 사용자가 연 탭에 연결됩니다.

SQL 분석은 브라우저 안에서 처리합니다. SQL을 개발자 서버나 AI 서비스로 전송하지 않으며, SQL 실행이나 데이터베이스 접속도 하지 않습니다. 사이트 접근은 사용자가 허용한 사이트에 적용되며, 클립보드는 사용자가 Clipboard를 누를 때만 읽습니다. Bitbucket에서는 전체 SQL을 읽기 위해 같은 사이트의 원본 파일을 요청할 수 있습니다.

베타 버전입니다. 모든 SQL 문법을 완벽히 분석하지는 않으며, 스키마 정보가 없는 컬럼 lineage는 불완전할 수 있습니다. 분석 결과와 원문을 함께 확인하세요. 확장 UI는 영어로 제공됩니다.

도움말: https://github.com/fivepairs67/superflow/blob/main/README.ko.md
문제 제보: https://github.com/fivepairs67/superflow/issues
개인정보처리방침: https://github.com/fivepairs67/superflow/blob/main/PRIVACY.md
