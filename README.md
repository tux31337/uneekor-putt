# Uneekor Putt · Putting Lab

React, TypeScript, Three.js로 만든 웹 기반 3D 퍼팅 시각화 시제품입니다. 그린 경사와 카메라를 바꾸고 외부 궤적을 시간에 맞춰 재생할 수 있습니다. 브라우저와 React Native WebView 연동을 위한 화면입니다.

**현재 기본 궤적은 5.15초짜리 화면 확인용 샘플입니다.** 실제 퍼팅 물리 계산이나 장비 데이터 연결은 아직 구현하지 않았습니다. 스팀프 설정으로 실제 공의 속도를 계산하지 않습니다.

## 시작하기

- Node.js **22.18.0 이상**과 npm
- Git 및 **Git LFS**: 기본 코스에서 사용하는 약 112MiB 수목 모델을 내려받는 데 필요합니다.
- WebGL 2를 지원하는 브라우저

```sh
git lfs install
git clone https://github.com/tux31337/uneekor-putt.git
cd uneekor-putt
git lfs pull
npm ci
npm run dev
```

개발 화면: <http://127.0.0.1:5173/>. 별도의 환경 변수나 백엔드 서버는 필요하지 않습니다. 이미 이 주소에서 서버가 응답하면 재사용합니다. 포트가 사용 중일 때 임의로 다른 포트로 변경하지 않도록 설정되어 있습니다.

GitHub의 ZIP 다운로드만 사용하면 LFS 모델이 빠질 수 있으므로 Git으로 복제합니다. 모델 로딩이 실패하면 먼저 `git lfs pull`과 `git lfs fsck`를 확인합니다.

## 현재 기능

- 거리 2–12m, 스팀프 6–14ft, 좌우·앞뒤 경사 각각 ±5% 설정
- 공 뒤·전체·탑뷰·잔디 근접 시점, 자동 카메라와 수동 회전·확대
- 준비 → 재생 → 결과 화면, 일시정지·탐색·속도 조절·다시 보기
- 격자·내리막 방향 흐름·높낮이·궤적 표시
- 잔디 접촉 변형, 공 딤플과 코팅, 수목·배경 비교
- JSON 궤적 불러오기와 React Native WebView 메시지 연동

그린은 좌우·앞뒤 경사로 정의한 하나의 평면입니다. 위치별 굴곡이나 마찰에 따른 물리 계산은 포함하지 않습니다.

## 화면과 자료

아래 경로는 개발 서버 주소 뒤에 붙입니다.

| 경로 | 용도 |
| --- | --- |
| `/` | 퍼팅 연습 화면 |
| `/?review=grass` | 기존/시제품 잔디, 같은 구도의 PNG 저장 |
| `/?review=tree` | 한 그루 수목 품질 비교 |
| `/?review=vegetation` | 수목 배치·표현 비교 |
| `/putting-details-20261028/index.html` | 공 접촉부·딤플·경사 흐름의 저장된 비교 보고서 |

저장된 비교 이미지는 **CPU 렌더**입니다. PC의 세로 화면 비율을 사용한 이미지도 실제 휴대폰 캡처나 성능 측정 결과가 아닙니다.

## 주요 명령

| 명령 | 용도 |
| --- | --- |
| `npm run dev` | 개발 서버, 기본 포트 5173 |
| `npm run typecheck` | TypeScript 타입 검사 |
| `npm test` | 궤적·재생·품질 제어 코어 테스트 |
| `npm run build` | 타입 검사 후 `dist/`에 프로덕션 빌드 |
| `npm run preview` | 빌드 결과 로컬 확인 |
| `npm run verify:render` | PC 가로 CPU 렌더 및 씬 회귀 검사 |
| `npm run verify:render -- --phone` | PC에서 세로 390×564 CPU 렌더 및 회귀 검사 |
| `npm run verify:details` | 보존된 원본과 공·잔디·경사 흐름 비교 |

렌더 검사에는 네이티브 모듈을 사용하는 `@drawcall/webgl`이 필요하며 일반 테스트보다 오래 걸립니다. 자세한 실행 조건과 과거 보고서를 보존하는 방법은 [개발 안내](docs/development.md)를 참고합니다.

## 프로젝트 구조

```text
src/core/        궤적 검증·보간, 재생 단계, 자동 품질 제어와 테스트
src/scene/       Three.js 씬, 잔디·공 재질, 경사 흐름, 수목
src/ui/          연습 화면, 비교 화면, WebView 메시지 처리
src/assets/      잔디 텍스처와 수목 메타데이터
public/         런타임 수목 자산과 저장된 비교 보고서
scripts/        자산 준비, CPU 렌더, 회귀 검사, 보고서 생성
artifacts/      로컬 렌더 산출물; 원본 비교 기준만 Git에 포함
examples/       불러올 수 있는 외부 궤적 JSON 예제
docs/           개발·연동 안내, 이전 인계 기록
```

## 문서와 진행 상태

- [개발·검증 안내](docs/development.md)
- [궤적 데이터와 WebView 연동](docs/integration.md)
- [외부 자산과 라이선스](THIRD_PARTY_NOTICES.md)
- [현재 상태와 다음 작업](HANDOFF.md)
- [프로젝트 작업 지침](AGENTS.md)

실제 브라우저에서 재생·회전·PNG 저장과 잔디 외형을 확인하는 작업, 모바일 실기기 성능 측정이 남아 있습니다. 이후 잔디 적용 범위를 결정하고 실제 퍼팅 계산을 연결합니다.

애플리케이션 소스 전체에 대한 라이선스는 아직 지정하지 않았습니다. 자산별 CC0 고지는 해당 자산에만 적용합니다.
