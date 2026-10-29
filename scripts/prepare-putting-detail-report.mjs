import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const sharp = (await import(pathToFileURL(require.resolve('sharp', { paths: [resolve('node_modules/@drawcall/webgl')] })).href)).default;
const round = 'putting-details-20261028', root = resolve('artifacts', round), publicRoot = resolve('public', round);
await mkdir(publicRoot, { recursive: true });
const views = { ball: '공 주변', macro: '공과 3mm 잔디 근접', edge: '그린 가장자리', 'edge-macro': '프린지·러프 근접', course: '코스 전체', rolling: '이동한 공 주변' };
const checks = [];
async function pair(left, right, target, width, height) {
  await sharp({ create: { width: width * 2, height, channels: 4, background: '#edf1e8' } }).composite([
    { input: left, left: 0, top: 0 }, { input: right, left: width, top: 0 },
  ]).jpeg({ quality: 94 }).toFile(target);
}
for (const size of ['desktop', 'mobile']) {
  const directory = resolve(root, 'cpu', size);
  const before = JSON.parse(await readFile(resolve(directory, 'before/verification.json'), 'utf8'));
  const after = JSON.parse(await readFile(resolve(directory, 'after/verification.json'), 'utf8'));
  const [width, height] = after.resolution;
  for (const key of ['sourceHashesVerified', 'airborneGrassUnchanged', 'externalTrajectoryUnchanged', 'stationaryFramesStable',
    'seekRoundTripStable', 'flowDownhillVerified', 'flowSpeedVerified', 'flatFlowStopped', 'hiddenFlowStopped',
    'reducedMotionFlowStopped', 'hiddenPageStopped', 'shotFlowHidden']) assert.equal(after[key], true, `${size}: ${key}`);
  assert.ok(after.compressionPixelDelta > 1000 && after.dimplePixelDelta > 1000 && after.flowPixelDelta > 1000);
  for (const view of Object.keys(views)) {
    assert.deepEqual(after.metrics.find(item => item.view === view).conserved, before.metrics.find(item => item.view === view).conserved, `${size}/${view}`);
    const file = `${size}-${view}.jpg`;
    await pair(resolve(directory, 'before', `${view}.png`), resolve(directory, 'after', `${view}.png`), resolve(root, file), width, height);
    await copyFile(resolve(root, file), resolve(publicRoot, file));
    checks.push({ size, view, cameraBallShotPlaneTreesLightAndGrassBudgetPreserved: true });
  }
  for (const [name, left, right] of [['flow', 'flow-0', 'flow-06'], ['contact', 'unpressed-blades', 'contact-blades']]) {
    const file = `${size}-${name}.jpg`;
    await pair(resolve(directory, 'after', `${left}.png`), resolve(directory, 'after', `${right}.png`), resolve(root, file), width, height);
    await copyFile(resolve(root, file), resolve(publicRoot, file));
  }
  for (const target of [root, publicRoot]) await copyFile(resolve(directory, 'after/flow-perspective.png'), resolve(target, `${size}-flow-perspective.png`));
  for (const target of [root, publicRoot]) await copyFile(resolve(directory, 'after/verification.json'), resolve(target, `${size}-verification.json`));
}
const status = { round, backend: 'CPU / @drawcall/webgl / Mesa lavapipe', browserCapture: false, physicalMobileDevice: false,
  fps: null, browserBlocker: 'No connected task browser; unrelated private windows were not accessed',
  originalReportsPreserved: true, grassTriangleBudgets: [216000, 118800, 54000],
  ballNormalTextureMiBWithMipmaps: 1024 * 512 * 4 * 4 / 3 / 1024 ** 2, maximumFlowFps: 30, checks };
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>공 접촉부 · 딤플 · 경사 흐름 비교</title>
<style>body{font:15px/1.8 system-ui,sans-serif;background:#f5f7ef;color:#293b29;max-width:1240px;margin:auto;padding:32px 24px 80px}h1{font-size:36px;letter-spacing:-.04em;line-height:1.3}h2{font-size:24px;margin-top:44px}p{max-width:900px;color:#596b54}a{color:#365e3d}img{display:block;width:100%;border-radius:10px}figure{margin:28px 0}figcaption{font-weight:600;margin-bottom:8px}.labels{display:grid;grid-template-columns:1fr 1fr;text-align:center;color:#66765c;font-size:13px;margin-bottom:5px}.badge{color:#647650;font-size:12px;letter-spacing:.12em}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #d6decd;padding:12px}@media(max-width:600px){body{padding:24px 12px}h1{font-size:28px}}</style>
<a href="../?review=grass">실시간 잔디 비교 ↗</a> · <a href="../">퍼팅 연습 ↗</a><p class="badge">TURF STUDY · 04 · 2026.10.28</p><h1>공이 잔디에 닿는 느낌과 경사 흐름</h1>
<p>왼쪽은 이번 작업 시작 전, 오른쪽은 보정 후입니다. 카메라·조명·공의 중심과 크기·재생 위치를 맞췄습니다. 모든 이미지는 CPU 참고 렌더이며 실제 브라우저나 휴대폰 캡처가 아닙니다.</p>
<table><tr><th>보정</th><th>동작</th></tr><tr><td>잔디 접촉</td><td>공의 아래쪽 구면과 닿는 잎만 짧게 굽혀 눕히고 접촉 음영을 공 바로 밑에 맞췄습니다. 공이 뜨면 눌림과 접촉 핵심 음영이 사라집니다. 지형이나 공의 높이는 바꾸지 않았습니다.</td></tr><tr><td>골프공</td><td>색 점 대신 둥글게 파인 딤플의 노멀과 얇은 코팅 반사를 적용했습니다. 먼 거리에서는 밉맵으로 미세한 무늬를 줄입니다.</td></tr><tr><td>경사 흐름</td><td>50cm 격자선 위의 짧은 표시가 각 축의 낮은 쪽으로 이동합니다. 경사가 강할수록 빨라지고, 평지에서는 사라집니다. 연습 화면의 ‘경사 방향’으로 켤 수 있습니다.</td></tr><tr><td>경사 설명</td><td>앞뒤 경사만 있는 경우에도 오르막·내리막을 표시합니다. 좌우와 앞뒤가 모두 0일 때 평지로 표시합니다.</td></tr></table>
${['desktop', 'mobile'].map(size => `<h2>${size === 'desktop' ? '가로 960×600' : '세로 390×564 · PC에서 비율 변경'}</h2>${Object.entries(views).map(([view,label]) => `<figure><figcaption>${label}</figcaption><div class="labels"><span>보정 전</span><span>보정 후</span></div><a href="${size}-${view}.jpg"><img loading="lazy" src="${size}-${view}.jpg" alt="${label} CPU 렌더 전후 비교"></a></figure>`).join('')}
<figure><figcaption>접촉 변형 진단 · 공과 지면을 숨긴 입체 잎</figcaption><div class="labels"><span>눌림 끔</span><span>눌림 켬</span></div><img loading="lazy" src="${size}-contact.jpg" alt="입체 잎의 접촉 변형만 분리한 CPU 렌더"></figure>
<figure><figcaption>같은 경사의 흐름 · 카메라와 그린 고정</figcaption><div class="labels"><span>0초</span><span>0.6초</span></div><img loading="lazy" src="${size}-flow.jpg" alt="같은 격자 위 흐름의 두 시간대 CPU 렌더"></figure><figure><figcaption>일반 공 시점의 흐름 · 먼 거리에서 선명도를 낮춤</figcaption><img loading="lazy" src="${size}-flow-perspective.png" alt="일반 공 시점에서 확인한 경사 흐름 CPU 렌더"></figure><p><a href="${size}-verification.json">보존·접촉·딤플·경사 흐름 검증 JSON</a></p>`).join('')}
<h2>검증과 남은 확인</h2><p>공의 중심·반지름, 홀·깃발, 퍼팅 면, 수목의 배치와 기하, 궤적의 좌표·높이·시간을 전후 대조했습니다. 공중의 외부 궤적에서 잔디가 변하지 않는지, 정지·탐색 후 같은 화면이 나오는지도 검사했습니다. 경사 흐름은 양 축의 양수·음수 방향과 속도를 실제 셰이더 픽셀로 확인했습니다. 정지된 준비 화면에서 흐름에 의한 추가 갱신을 최대 30회/초로 제한하며 숨김·평지·동작 줄이기·탭 숨김·재생 단계에서는 흐름의 추가 렌더를 멈추는지 검사했습니다. 이 수치는 CPU 환경의 일정 검사이며 실기기 FPS 측정값이 아닙니다.</p>
<p>잔디 삼각형 예산은 216,000 / 118,800 / 54,000으로 유지했습니다. 공 노멀 텍스처는 밉맵 포함 약 2.7MiB를 추가하고, 공의 코팅 조명과 잎의 접촉 계산 및 경사 표시 셰이더 비용이 생깁니다. 작업용 브라우저 연결이 없어 실제 브라우저의 재생·회전·PNG 저장을 검증하지 못했고, 모바일 실기기의 FPS·GPU 시간·메모리 측정도 수행하지 못했습니다. 잎의 각진 단면과 밀도 경계에 대한 품질 판단도 남아 있습니다. 현재 5.15초 퍼팅은 화면 확인용 샘플입니다.</p>
<p><a href="status.json">전체 검증 JSON</a> · <a href="../grass-depth-20261028/index.html">이전 밀도·깊이 보강 비교</a></p></html>`;
for (const target of [root, publicRoot]) {
  await writeFile(resolve(target, 'status.json'), JSON.stringify(status, null, 2) + '\n');
  await writeFile(resolve(target, 'index.html'), html);
}
console.log('Putting details: 12 before/after views plus contact/flow diagnostics; original comparisons preserved.');
