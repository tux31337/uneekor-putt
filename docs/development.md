# 개발·검증 안내

## 환경과 실행

[README](../README.md)의 복제·LFS·설치 순서를 먼저 진행합니다. `package-lock.json` 기준으로 `npm ci`를 사용합니다. 저장소 정리 시 확인한 환경은 Windows, Node.js 24.22.1, npm 11.19.1입니다. 지원 최소 버전은 `package.json`의 Node.js 22.18.0입니다.

`npm run dev`는 5173 포트에서 실행되며 모바일 기기 접속을 위해 모든 네트워크 인터페이스에 바인딩합니다. 같은 네트워크의 실기기는 개발 PC의 IP와 포트로 접속합니다. 실제 접속 여부와 방화벽 설정은 기기별로 확인해야 합니다. 개발 서버의 `/__putting-diagnostics`는 진단 정보를 `.tmp/render-diagnostics.ndjson`에 기록합니다.

`npm run build`는 타입 검사와 Vite 빌드를 실행합니다. `npm run preview`는 빌드 결과를 확인하는 로컬 서버입니다. 배포용 산출물은 `dist/`이며 자산을 포함합니다. 이 저장소에는 호스팅이나 자동 배포 설정이 없습니다.

## 검증 순서

```sh
npm run typecheck
npm test
npm run build
```

씬·카메라·재질·궤적을 변경했다면 관련 렌더 검사도 실행합니다.

```sh
npm run verify:render
npm run verify:render -- --portrait
npm run verify:render -- --phone
npm run verify:details
```

| 검사 | 범위와 출력 |
| --- | --- |
| `npm test` | 궤적 파싱·시간 보간, 결과·남은 거리, 자동 품질 제어 |
| `verify:render` | 960×600, `.tmp/render/` |
| `verify:render -- --portrait` | 390×520, `.tmp/render/portrait/` |
| `verify:render -- --phone` | 390×564, `.tmp/render/phone/` |
| `verify:details` | 가로/세로 접촉·딤플·경사 흐름 및 씬 검사; `artifacts/putting-details-20261028/`와 `public/putting-details-20261028/` 갱신 |

CPU 렌더는 실제 Three.js 씬의 기하·픽셀·재생 동작을 검사합니다. React UI, 브라우저 입력, 다운로드, GPU 성능이나 실기기 FPS를 검증하지 않습니다. 첫 커밋 준비 과정에서는 코어 테스트와 빌드, 문서·예제·자산 무결성을 검증하며 기존 CPU 비교 결과를 새로 생성하지 않습니다.

`verify:details`가 요구하는 `artifacts/putting-details-20261028/cpu/{desktop,mobile}/before/` 원본 이미지와 JSON은 Git에 보존합니다. `--details-before`로 이를 다시 생성하지 않습니다. 원본과 결과를 비교하는 기준은 `scripts/grass-baseline.json`이며, 통과시키기 위해 기준 해시를 바꾸지 않습니다.

`@drawcall/webgl` 또는 이미지 처리 모듈 로딩이 실패하면 해당 OS와 아키텍처의 네이티브 의존성 설치 상태를 확인합니다. 이 경우 실패한 렌더 검사와 통과한 코어 검사를 구분해 기록합니다.

## 비교 자료와 자산 관리

| 위치 | 관리 방식 |
| --- | --- |
| `public/` | 런타임 자산과 브라우저에서 여는 비교 보고서, Git 포함 |
| `public/vegetation/external/tree-small-02/tree-small-02.glb` | 약 112MiB, Git LFS로 저장 |
| `artifacts/.../before/` | 현재 상세 비교에 필요한 변경 전 기준, Git 포함 |
| 그 밖의 `artifacts/` | CPU 원본 렌더·중간 보고서, 로컬 보존 및 Git 제외 |
| `.references/` | 내려받은 원본·영상 참고 자료, 로컬 전용 |
| `.tmp/` | 임시 렌더·백업·진단, 로컬 전용 |

`.gitattributes`는 기존 소스의 줄바꿈을 변환하지 않습니다. 보호 대상의 바이트 단위 해시 검사를 다른 환경에서도 유지하기 위한 설정입니다. Markdown은 LF로 저장합니다.

기본 화면을 실행하기 위해 자산 생성 명령을 다시 실행할 필요는 없습니다. 기존 모델·텍스처와 LFS 모델을 사용합니다. 다음 명령은 자산을 의도적으로 다시 준비할 때만 사용합니다.

| 명령 | 동작과 선행 조건 |
| --- | --- |
| `npm run assets:vegetation` | 프로젝트 수목 모델과 이미지 아틀라스 재생성 |
| `npm run assets:reference-tree` | Poly Haven 원본 다운로드·검사 후 GLB 준비; 네트워크 필요 |
| `npm run verify:vegetation` | 수목 비교 렌더와 보고서 갱신 |
| `npm run verify:tree` | 한 그루 비교; `.references/tree-small-02/`의 원본 이미지와 기존 수목 보고서 필요 |
| `npm run verify:grass` | 최초 잔디 보고서 갱신 |
| `npm run verify:grass:refinement` / `npm run verify:grass:depth` | 과거 날짜의 비교 자료 갱신; 이전 차수의 로컬 `artifacts/` 필요 |

과거 날짜를 사용하는 명령을 일반 회귀 검사로 실행하지 않습니다. 원본 비교를 덮어쓸 수 있으며, Git에 제외된 과거 CPU 이미지가 없어 새 복제본에서는 실행되지 않을 수 있습니다. 현재 회귀 검사는 `verify:render`와 `verify:details`를 사용합니다. 저장된 비교 화면은 `public/`에서 바로 볼 수 있습니다.

## 실제 화면 확인과 다음 단계

1. 개발 서버의 HTTP 응답을 확인한 뒤 작업용 브라우저에서 `/?review=grass`를 엽니다.
2. 같은 카메라·조명·재생 위치에서 잎 단면·밀도 전환·공 접촉·딤플을 비교합니다.
3. 재생·정지·탐색·회전·PNG 저장과 일반 화면의 경사 흐름 및 문구를 확인합니다.
4. 모바일 실기기에서 기기/OS/브라우저, 해상도·DPR·품질과 FPS·프레임 지연·GPU 시간·메모리를 기록합니다. 측정할 수 없는 항목은 미측정으로 남깁니다.

수목 배치와 작은 나무 21그루 제거 상태, 공·홀·깃발, 퍼팅 면과 입력 궤적의 좌표·높이·시간을 유지합니다. 작업 후 [HANDOFF.md](../HANDOFF.md)의 검증 범위와 다음 실행 항목을 갱신합니다.
