import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
if (process.platform === 'win32' && !process.env.FONTCONFIG_FILE) {
  const cache = resolve('.tmp/vegetation-font-cache').replaceAll('\\', '/');
  await mkdir(cache, { recursive: true });
  const config = resolve('.tmp/vegetation-fonts.conf');
  await writeFile(config, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>C:/Windows/Fonts</dir><cachedir>${cache}</cachedir></fontconfig>`);
  process.env.FONTCONFIG_FILE = config;
}
const sharp = (await import(pathToFileURL(require.resolve('sharp', { paths: [resolve('node_modules/@drawcall/webgl')] })).href)).default;
const root = resolve('artifacts/vegetation-review');
const manifest = JSON.parse(await readFile('public/vegetation/manifest.json', 'utf8'));
const labels = { original: 'ORIGINAL', images: 'A / WHOLE-TREE IMAGES', hybrid: 'B / 3D + IMAGES' };
const views = { ball: 'BALL', perspective: 'OVERVIEW', top: 'TOP' };
const modeNames = { original: '기존', images: 'A · 전체 이미지', hybrid: 'B · 3D 혼합' };
const metrics = {};
const svg = (width, height, text, small = '') => Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f3f6ed"/><text x="14" y="25" fill="#28482f" font-family="Arial,sans-serif" font-size="13" font-weight="600">${text}</text><text x="14" y="43" fill="#7c8d70" font-family="Arial,sans-serif" font-size="10">${small}</text></svg>`);

for (const size of ['desktop', 'mobile']) {
  metrics[size] = JSON.parse(await readFile(resolve(root, 'cpu', size, 'metrics.json'), 'utf8'));
  const [width, height] = size === 'desktop' ? [320, 200] : [260, 376];
  for (const focus of [false, true]) {
    const layers = [];
    for (const [row, camera] of Object.keys(views).entries()) {
      for (const [column, mode] of Object.keys(labels).entries()) {
        const top = row * (height + 52), left = column * width;
        layers.push({ input: svg(width, 52, labels[mode], `${views[camera]} / ${focus ? 'TREE INSPECTION' : 'SAME SHOT CAMERA'} / CPU REFERENCE`), left, top });
        const input = await sharp(resolve(root, 'cpu', size, mode, `${camera}${focus ? '-tree' : ''}.png`)).resize(width, height).jpeg({ quality: 93 }).toBuffer();
        layers.push({ input, left, top: top + 52 });
      }
    }
    await sharp({ create: { width: width * 3, height: (height + 52) * 3, channels: 3, background: '#f3f6ed' } }).composite(layers).jpeg({ quality: 92 }).toFile(resolve(root, `${size}${focus ? '-trees' : ''}.jpg`));
  }
  await copyFile(resolve(root, `${size}.jpg`), `public/vegetation/review-${size}.jpg`);
}

const assetTiles = [];
for (let variant = 0; variant < 6; variant++) {
  const info = manifest.trees[variant];
  assetTiles.push({ input: svg(190, 52, info.name, `${info.triangles.toLocaleString('en')} triangles / original GLB`), left: variant * 190, top: 0 });
  for (let row = 0; row < 2; row++) {
    const buffer = await sharp(`public/vegetation/atlases/${info.name}.png`).extract({ left: 0, top: row ? manifest.tile * 3 : 0, width: manifest.tile, height: manifest.tile }).resize(190, 190).png().toBuffer();
    assetTiles.push({ input: buffer, left: variant * 190, top: 52 + row * 190 });
  }
}
await sharp({ create: { width: 1140, height: 432, channels: 3, background: '#d8e1d0' } }).composite(assetTiles).jpeg({ quality: 92 }).toFile(resolve(root, 'six-assets.jpg'));

const assetRows = [];
let modelBytes = 0, imageBytes = 0;
for (const tree of manifest.trees) {
  const glbBytes = (await stat(`public/vegetation/models/${tree.name}.glb`)).size;
  const pngBytes = (await stat(`public/vegetation/atlases/${tree.name}.png`)).size;
  modelBytes += glbBytes; imageBytes += pngBytes;
  assetRows.push(`<tr><td>${tree.name}</td><td>${tree.height.toFixed(1)}m</td><td>${tree.triangles.toLocaleString('en')}</td><td>${(glbBytes / 1048576).toFixed(2)} MiB</td><td>${(pngBytes / 1048576).toFixed(2)} MiB</td></tr>`);
}
imageBytes += (await stat('public/vegetation/forest-clusters.png')).size;
const metricRows = ['desktop', 'mobile'].flatMap(size => metrics[size].metrics.map(row => `<tr><td>${size === 'desktop' ? '가로' : '세로'}</td><td>${modeNames[row.mode]}</td><td>${views[row.camera]}</td><td>${row.drawCalls}</td><td>${row.triangles.toLocaleString('en')}</td><td>미측정</td></tr>`));
const galleries = ['desktop', 'mobile'].map(size => `<section><h2>${size === 'desktop' ? 'PC 가로 960×600' : '모바일 세로 비율 390×564'}</h2><p>아래 화면은 CPU 참고 렌더입니다. 같은 해상도·DPR 1·고정 품질이며, 각 시점의 카메라 행렬과 공·그린 상태가 기존/A/B에서 일치함을 자동 검증했습니다.</p><a href="${size}.jpg"><img src="${size}.jpg" alt="${size} 기존 A B 동일 구도 비교"/></a><details><summary>가지·수관 근접 검사 구도</summary><p>기본 탑뷰에는 나무가 화면 밖에 있어, 주요 나무를 중심으로 같은 카메라를 추가했습니다. 이 구도는 공·홀 프레이밍 검사와 별개입니다.</p><img loading="lazy" src="${size}-trees.jpg" alt="${size} 나무 근접 검사 비교"/></details><h3>360° 회전</h3><p>공 뒤·전체는 기존 그린 중심 구도, 탑뷰는 나무 근접 구도입니다. 각 GIF는 33개의 CPU 렌더를 이어 붙인 참고 애니메이션이며 실제 브라우저 캡처 영상이 아닙니다.</p><div class="animations">${Object.keys(labels).map(mode => `<article><h4>${modeNames[mode]}</h4>${Object.keys(views).map(camera => `<details><summary>${views[camera]} · 회전 보기</summary><a href="cpu/${size}/${mode}/${camera}-orbit.gif"><img loading="lazy" src="cpu/${size}/${mode}/${camera}-orbit.gif" alt="${mode} ${camera} CPU 회전"/></a><a href="cpu/${size}/${mode}/${camera}-orbit-strip.jpg">8방향 정지 프레임</a> · <a href="cpu/${size}/${mode}/${camera}.png">원본 PNG</a> · <a href="cpu/${size}/${mode}/${camera}-rotation.json">회전 검사 기록</a></details>`).join('')}</article>`).join('')}</div></section>`).join('');

const status = {
  generatedAt: new Date().toISOString(),
  recommendation: { mode: null, status: 'NOT APPROVED: user rejected generated tree shape and materials; see the single external-tree study' },
  visualReference: { backend: 'CPU / @drawcall/webgl / Mesa lavapipe', primaryScreens: 18, treeInspectionScreens: 18, turntables: 18, framesPerTurntable: 33, resolutions: [[960, 600], [390, 564]], fixedDpr: 1 },
  browserPerformance: { status: 'not-measured', reason: 'Windows Computer Use stopped because it could not verify the current browser URL. No further browser automation was attempted.', pc60Fps: 'unverified', mobile30Fps: 'unverified', gpuFrameTime: 'not-measured', mobileHardware: 'not-accessed' },
  assets: { forms: 6, azimuths: 8, elevations: [0, 30, 60, 90], heroModels: 6, forestClusters: 14, modelBytes, imageBytes, license: 'CC0-1.0 original vegetation asset files only' },
};
await writeFile(resolve(root, 'status.json'), JSON.stringify(status, null, 2) + '\n');
await writeFile(resolve(root, 'index.html'), `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>나무·배경 교체 시제품 비교</title><style>body{margin:0;background:#f3f6ed;color:#293d2c;font:15px/1.85 system-ui,"Malgun Gothic",sans-serif}main{max-width:1140px;margin:auto;padding:35px 24px 80px}h1{font-size:32px;letter-spacing:-1px;line-height:1.4}h2{margin-top:30px;font-size:23px}h3{font-size:17px}p{color:#738168}a{color:#3f743e}img{max-width:100%;display:block;border-radius:8px;margin:15px 0}section{padding:15px 0 30px;border-bottom:1px solid #d9e2d0}.notice{padding:20px 24px;border-radius:12px;background:#e3ecd8}.notice strong{font-size:19px}.notice p{margin:7px 0}.table{overflow:auto}table{width:100%;border-collapse:collapse;white-space:nowrap;font-size:13px}td,th{padding:10px 12px;text-align:left;border-bottom:1px solid #d9e2d0}th{font-weight:600;background:#e9efdf}.animations{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}details{border:1px solid #d9e2d0;border-radius:8px;padding:12px;margin:12px 0}summary{cursor:pointer;font-size:13px}li{margin:9px 0}code{font-size:12px;background:#e7eddf;padding:3px 6px;border-radius:4px}.stamp{font-size:12px;letter-spacing:1px;color:#8c9b80}.run{display:inline-block;margin-top:12px;border-radius:6px;background:#2e5036;color:white;padding:9px 15px;text-decoration:none}@media(max-width:650px){main{padding:20px 12px}h1{font-size:26px}.animations{grid-template-columns:1fr}}</style><main><p class="stamp">PUTTING LAB / COURSE STUDY / 2026.10.27</p><h1>나무·배경 교체 시제품</h1><div class="notice"><strong>이전 A/B 기록 · 사용자 수목 품질 미승인</strong><p><b>A와 B는 같은 자동생성 나무를 쓰며, 사용자는 형태와 재질이 여전히 조잡하고 어색하다고 평가했습니다. B는 승인된 결과가 아닙니다. <a href="http://127.0.0.1:5173/?review=tree">외부 수목 한 그루 비교</a>를 먼저 확인하세요.</b></p><p>이전 작업에서 가지·수관·관목과 빈 공간을 배치했습니다. 가까운 6개 나무는 실제 GLB 자산, 중경은 전체 나무의 시점별 이미지, 원경은 14개 군락 이미지로 구성합니다.</p><p><b>실제 브라우저·PC·모바일 FPS는 미측정입니다.</b> Windows 브라우저 자동화가 현재 URL을 확인하지 못해 정책상 중단됐습니다. CPU 렌더와 삼각형 수로 목표 FPS 달성을 판단하지 않습니다.</p><a class="run" href="http://127.0.0.1:5173/?review=vegetation">실제 브라우저 비교·측정 화면 열기</a></div>
<section><h2>구현과 유지 범위</h2><ul><li>기존 / A / B를 연습 화면에서 전환합니다. A와 B는 같은 6종 자산과 배치를 사용하며, 가까운 나무의 3D/이미지 표현을 비교합니다.</li><li>6종 × 8방향 × 4고도(0/30/60/90도) 이미지를 사용합니다. 인접 시점을 한 장의 깊이를 쓰는 알파 컷아웃 안에서 보간하고, 원경 군락도 4고도 이미지를 사용합니다.</li><li>3D 원본은 연결된 굽은 줄기·가지, 낮은 분기, 뿌리 퍼짐과 개별 접힌 잎을 포함합니다. 긴 맨줄기와 동일 수관의 반복을 교체했습니다.</li><li>불규칙 간격과 관목을 추가하고, 주변 지형 높이에 뿌리와 접지 음영을 맞췄습니다. 기존 하늘·태양·안개·지형은 동일하게 두어 자산 차이를 비교합니다.</li><li>공·홀·깃발·외부 궤적의 좌표/시간·퍼팅 면의 heightAt 경사 계산과 기본 카메라 프레이밍을 유지했습니다.</li></ul></section>
${galleries}
<section><h2>외형과 회전에서 확인한 내용</h2><ul><li>B는 가까운 나무의 가지 사이 공간, 원근 시차와 위에서 본 수관 구조가 남습니다. 기본 비교 및 나무 근접 구도 모두 기존/A/B의 카메라가 같습니다.</li><li>A는 가까운 탑뷰에서 256px 원본 타일의 확대와 보간으로 수관이 흐려집니다. 평면이 옆으로 서서 사라지는 현상은 카메라 대면 검사로 방지하지만, 실제 3D와 같은 시차를 만들지는 못합니다.</li><li>각 360° CPU 회전 33프레임에서 이미지 카드가 카메라를 향하고 변환 행렬이 유한한지 검사했습니다. 방위각 끝의 순환도 포함합니다. 전체 프레임 차이 수치는 기록하지만, 지각적인 전환 튐이 없다는 증거로 쓰지 않습니다.</li><li>초기 픽셀 디더 전환의 점무늬를 확인하고 제거했습니다. 최종안은 시점 보간을 사용합니다. 여전히 가지 윤곽이 겹치거나 변형되어 보일 수 있어 실제 브라우저 회전 확인이 남아 있습니다.</li><li>원경 군락은 여전히 평면 자산입니다. 코스에서 떨어뜨리고 지형·안개로 연결하며, 숲 안 이동과 극단적인 확대에서는 추가 자산이 필요합니다.</li></ul></section>
<section><h2>렌더 구조 비교 — 성능 실측과 구분</h2><p>아래는 같은 정지 프레임에서 Three.js가 보고한 호출·삼각형 수입니다. CPU 렌더의 구조 지표이며 실제 GPU 처리 시간이나 지속 재생 FPS가 아닙니다.</p><div class="table"><table><thead><tr><th>화면</th><th>안</th><th>시점</th><th>draws</th><th>삼각형</th><th>실제 FPS</th></tr></thead><tbody>${metricRows.join('')}</tbody></table></div><p>A는 기하 수가 가장 작지만 겹친 이미지의 픽셀 처리와 4회 텍스처 샘플 비용이 있습니다. B는 가까운 3D 나무 때문에 A보다 호출과 기하가 늘어납니다. 삼각형 수 감소만으로 더 빠르다고 결론 내리지 않습니다.</p><p>PNG의 RGBA8 + 전체 mipmap을 가정한 식생 텍스처 메모리 추정은 약 80 MiB입니다. 실제 GPU 메모리와 다중 샘플 비용은 측정하지 않았습니다. 전송 파일은 A 약 ${(imageBytes / 1048576).toFixed(1)} MiB, B는 GLB 약 ${(modelBytes / 1048576).toFixed(1)} MiB가 추가됩니다. 캐시·HTTP 압축·잔디·앱 번들은 이 수치에서 제외합니다.</p></section>
<section><h2>브라우저에서 재현하는 방법</h2><ol><li>프로젝트에서 <code>npm run dev</code> 후 위 비교 화면을 엽니다. 일반 연습 화면의 “동일 조건 비교”로도 들어갈 수 있습니다.</li><li>가로 960×600 또는 세로 390×564, 공 뒤/전체/탑뷰를 선택합니다. DPR 1과 고정 품질을 사용해 자동 해상도 변화가 비교에 섞이지 않게 합니다.</li><li>“동일 구도 PNG 3개”로 실제 브라우저 화면을 얻고, “360° 회전·영상 저장”으로 현재 안의 WebM을 얻습니다. 주요 나무 근접 검사도 선택할 수 있습니다.</li><li>측정 기기를 정확히 선택하고 3회 반복을 권장합니다. 각 안은 자산 로딩 후 1.5초 준비 + 6초 연속 재생입니다. 반복마다 안의 순서를 교대하고 탭이 숨겨지면 측정을 취소합니다.</li><li>FPS·p95/p99 프레임 간격·CPU 렌더 제출 시간·호출/삼각형·렌더러·사용자 에이전트·해상도를 JSON으로 저장합니다. CPU 제출 시간은 GPU 시간이 아닙니다.</li><li>PC 60FPS, 모바일 실기기 30FPS를 기준으로 평균과 p95를 함께 봅니다. PC의 세로 화면, CPU 렌더, 모바일 기기 이름만 선택한 결과를 모바일 실측으로 대체하지 않습니다. 60Hz 화면의 FPS 상한도 고려합니다.</li></ol><p>현재 PC·Android·iOS·WebView 실기기 성능, GPU 시간, 투명 픽셀 겹침, 발열에 따른 장시간 성능은 미확인입니다. 형태 개선을 이유로 B를 기본 시제품으로 두되 최종 채택은 실기기 비교 후 결정합니다.</p></section>
<section><h2>자산의 출처와 라이선스</h2><p>이번 나무 모델·시점별 이미지·숲 군락은 모두 이 프로젝트에서 새로 만든 원본이며 외부 나무 자산을 다운로드하지 않았습니다. 해당 원본 자산 파일은 <a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0-1.0</a>로 제공하며 앱 소스·기존 자산의 라이선스를 변경하지 않습니다. <a href="../../public/vegetation/LICENSE.txt">전체 출처·라이선스 기록</a></p><img src="six-assets.jpg" alt="6종 원본 나무 정면과 탑뷰"/><div class="table"><table><thead><tr><th>자산</th><th>높이</th><th>삼각형</th><th>GLB</th><th>8×4 PNG atlas</th></tr></thead><tbody>${assetRows.join('')}</tbody></table></div><p>생성 소스: <a href="../../src/scene/vegetation/TreeModels.ts">TreeModels.ts</a> · <a href="../../scripts/generate-vegetation.mjs">GLB 내보내기</a> · <a href="../../scripts/bake-vegetation.mjs">CPU 이미지 베이크</a>. 수종 이름은 의도한 형태를 설명하며 실측 식물 스캔은 아닙니다.</p><p>기존 잔디는 ambientCG Grass004(CC0)를 유지합니다. <a href="../../src/assets/turf/LICENSE.txt">기존 고지</a>. Three.js(MIT), @drawcall/webgl(MIT), Sharp(Apache-2.0)는 구현·생성 도구이며 나무 모델의 외부 출처가 아닙니다.</p><p>기술 참고: <a href="https://threejs.org/manual/pages/billboards.html">Three.js 공식 billboards 문서</a>의 시점별 파사드 방식, <a href="https://developer.android.com/games/optimize/materials">Android 공식 재질 지침</a>의 투명 겹침·알파 방법별 비교 권고를 반영했습니다.</p></section>
<section><h2>검증 기록</h2><p>타입 검사와 프로덕션 빌드, 기존 궤적·재생·자동 품질 테스트 10개를 통과했습니다. 실제 씬을 사용하는 CPU 회귀 검사는 2–12m, ±5% 경사에서 퍼팅 평면과 공·홀·깃발 프레이밍, 시간·높이 보존, 재생/정지/탐색/재시작, 자동 품질과 가까운 GLB 보존을 확인합니다. 브라우저 측정기의 준비 시간·프레임 집계·숨김 탭 취소는 합성 시간으로 로직만 검사하며 성능 결과로 저장하지 않습니다.</p><p>이 보고서에는 실제 브라우저 스크린샷·브라우저 회전 녹화·실기기 FPS가 포함되지 않습니다. <a href="status.json">측정 범위 JSON</a> · <a href="cpu/desktop/metrics.json">가로 구조 지표</a> · <a href="cpu/mobile/metrics.json">세로 구조 지표</a></p></section></main></html>`);
console.log(`Prepared ${resolve(root, 'index.html')}`);
