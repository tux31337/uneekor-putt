import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const sharp = (await import(pathToFileURL(require.resolve('sharp', { paths: [resolve('node_modules/@drawcall/webgl')] })).href)).default;
const round = process.argv.find(arg => arg.startsWith('--round='))?.split('=')[1] ?? 'grass-refinement-20261028';
const previousName = process.argv.find(arg => arg.startsWith('--previous='))?.split('=')[1] ?? 'grass-review';
for (const name of [round, previousName]) assert.match(name, /^[a-z0-9-]+$/);
const depthStudy = round.startsWith('grass-depth');
const previous = resolve('artifacts', previousName);
const root = resolve('artifacts', round), publicRoot = resolve('public', round);
await mkdir(publicRoot, { recursive: true });
const views = { ball: '공 주변', macro: '3mm 잎 근접', edge: '그린 가장자리', 'edge-macro': '프린지·러프 근접', course: '코스 전체', rolling: '이동한 공 주변' };
const checks = [];
for (const size of ['desktop', 'mobile']) {
  const before = JSON.parse(await readFile(resolve(previous, 'cpu', size, 'verification.json'), 'utf8'));
  const after = JSON.parse(await readFile(resolve(root, 'cpu', size, 'verification.json'), 'utf8'));
  assert.equal(after.metrics.length, 12);
  for (const key of ['sharedCameraAndLighting', 'preservedPuttingAndTrees', 'lightingResponse', 'shadowResponse', 'sourceHashesVerified', 'stationaryFramesStable', 'seekRoundTripStable']) assert.equal(after[key], true, key);
  assert.equal(after.browserCapture, false); assert.equal(after.physicalMobileDevice, false); assert.equal(after.fps, null);
  for (const view of Object.keys(views)) {
    const oldState = before.metrics.find(item => item.grassMode === 'prototype' && item.view === view);
    const newState = after.metrics.find(item => item.grassMode === 'prototype' && item.view === view);
    for (const key of ['cameraMatrix', 'projectionMatrix', 'ball', 'elapsed', 'green', 'width', 'height', 'pixelRatio', 'heroModels', 'imageTrees', 'forestClusters', 'externalTrees', 'viewSamples', 'triangles']) {
      assert.deepEqual(newState[key], oldState[key], `${size}/${view}: changed ${key} between revisions`);
    }
    for (const key of Object.keys(oldState.grass)) assert.deepEqual(newState.grass[key], oldState.grass[key], `${size}/${view}: changed the existing grass budget/scale ${key}`);
    if (depthStudy) {
      assert.ok(after.bladePixelDelta > 1000 && after.reliefPixelDelta > 1000, 'Both geometry and relief must be visible');
      assert.equal(newState.grass.denseGreenTufts, 4800);
      assert.ok(newState.grass.nearDensityGain > 7);
    }
    const [width, height] = after.resolution;
    const decode = file => sharp(file).ensureAlpha().raw().toBuffer();
    const [oldBaseline, newBaseline, oldPixels, newPixels] = await Promise.all([
      decode(resolve(previous, 'cpu', size, 'baseline', `${view}.png`)),
      decode(resolve(root, 'cpu', size, 'baseline', `${view}.png`)),
      decode(resolve(previous, 'cpu', size, 'prototype', `${view}.png`)),
      decode(resolve(root, 'cpu', size, 'prototype', `${view}.png`)),
    ]);
    assert.deepEqual(newBaseline, oldBaseline, `${size}/${view}: the unchanged legacy render differs from the saved reference`);
    if (view === 'course') assert.deepEqual(newPixels, oldPixels, `${size}: distant course changed`);
    const file = `${size}-${view}.jpg`;
    await sharp({ create: { width: width * 2, height, channels: 4, background: '#edf1e8' } }).composite([
      { input: await sharp(oldPixels, { raw: { width, height, channels: 4 } }).png().toBuffer(), left: 0, top: 0 },
      { input: await sharp(newPixels, { raw: { width, height, channels: 4 } }).png().toBuffer(), left: width, top: 0 },
    ]).jpeg({ quality: 94 }).toFile(resolve(root, file));
    await copyFile(resolve(root, file), resolve(publicRoot, file));
    checks.push({ size, view, sameCameraShotAndTrees: true, unchangedLegacyPixels: true,
      previousPrototypeSha256: createHash('sha256').update(oldPixels).digest('hex'),
      refinedPrototypeSha256: createHash('sha256').update(newPixels).digest('hex') });
  }
  for (const target of [root, publicRoot]) await copyFile(resolve(root, 'cpu', size, 'verification.json'), resolve(target, `${size}-verification.json`));
}
const status = { round, comparison: 'previous prototype / refined prototype', backend: 'CPU / @drawcall/webgl / Mesa lavapipe',
  browserCapture: false, physicalMobileDevice: false, fps: null,
  browserBlocker: 'Automatic approval review rejected reading an unrelated private Chrome window; no connected task browser available',
  originalReportPreserved: true, unchangedLegacyPixels: true, sameCameraShotAndTrees: true,
  grassTriangleBudgets: [216000, 118800, 54000], depthStudy, checks };
for (const target of [root, publicRoot]) await writeFile(resolve(target, 'status.json'), JSON.stringify(status, null, 2) + '\n');

const depthChanges = `<table><tr><th>평평해 보이던 원인</th><th>이번 변경</th></tr><tr><td>드문드문 서 있던 입체 잎</td><td>기존 잎 예산의 80%를 공 주변 반경 15cm에 집중합니다. 가까운 곳의 포기 밀도가 약 7.5배가 되어 잎이 겹치는 층이 보입니다. 나머지 잎으로 바깥 구간을 이어 줍니다.</td></tr><tr><td>낮은 대비의 평면 질감</td><td>잎 색과 높이를 함께 생성해 잎의 결, 잘린 끝과 틈의 명암을 분리합니다. 높이 지도는 기존 노멀 텍스처의 알파 채널을 재사용합니다.</td></tr><tr><td>비껴 볼 때도 움직이지 않던 바닥 무늬</td><td>가까운 곳에서는 약 1.2mm 깊이의 표면을 따라 시차를 계산하고 잎의 옆면에 빛이 다르게 닿게 합니다. 미해상도에서는 깊이 표현을 필터링합니다.</td></tr><tr><td>보존과 비용</td><td>그린 3mm / 프린지 11mm / 러프 30mm와 실제 퍼팅 면, 공과 궤적은 그대로입니다. 삼각형 예산 216,000 / 118,800 / 54,000과 텍스처 자산 수는 유지했습니다. 추가 샘플링 비용과 실제 기기 성능은 미측정입니다.</td></tr></table>`;
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>잔디 ${depthStudy ? '밀도와 깊이' : '보정'} · 수정 전후 비교</title>
<style>body{font:15px/1.8 system-ui,sans-serif;background:#f5f7ef;color:#293b29;max-width:1240px;margin:auto;padding:32px 24px 80px}h1{font-size:36px;letter-spacing:-.04em;line-height:1.25}h2{font-size:24px;margin-top:48px}p{max-width:900px;color:#596b54}a{color:#365e3d}img{display:block;width:100%;border-radius:10px}figure{margin:28px 0}figcaption{font-weight:600;margin-bottom:8px}.labels{display:grid;grid-template-columns:1fr 1fr;text-align:center;color:#66765c;font-size:13px;margin-bottom:5px}.badge{color:#647650;font-size:12px;letter-spacing:.16em}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #d6decd;padding:12px}@media(max-width:600px){body{padding:24px 12px}h1{font-size:28px}}</style>
<a href="../?review=grass">실시간 잔디 비교 열기 ↗</a><p class="badge">TURF STUDY · ${depthStudy ? '03' : '02'} · 2026.10.28</p><h1>${depthStudy ? '가까이서 보이는 잔디의 밀도와 깊이' : '잎과 지면이 자연스럽게 이어지도록'}</h1>
<p>왼쪽은 이전 시제품, 오른쪽은 이번 보정입니다. 카메라·해상도·조명·샘플 재생 위치를 동일하게 유지했습니다. 모든 이미지는 CPU 참고 렌더이며 실제 브라우저나 휴대폰 캡처가 아닙니다.</p>
${depthStudy ? depthChanges : '<table><tr><th>보정 대상</th><th>변경</th></tr><tr><td>밝은 선과 색 차이</td><td>잎과 바닥이 사진 재질의 평균색과 짧은 잎 색 지도를 공유합니다. 잘린 끝의 밝은 띠를 없애고 뿌리의 명암을 완만하게 조정했습니다.</td></tr><tr><td>포기 간격과 형태</td><td>빈 곳을 줄이는 비정렬 배치, 작은 뿌리 다발, 서로 다른 굽힘·폭·비틀림을 적용했습니다. 세 잎과 세 굽힘 구간, 폭이 남는 절단면은 유지했습니다.</td></tr><tr><td>지면 접지</td><td>가장자리의 실제 지면 삼각형을 기준으로 뿌리를 약 0.18mm 묻습니다. 그린 3mm / 프린지 11mm / 러프 30mm와 퍼팅 면 경사는 유지했습니다.</td></tr><tr><td>비용</td><td>삼각형 예산 최대 216,000 / 중간 118,800 / 성능 우선 54,000 유지. 기존 텍스처를 공유하며 색을 맞추기 위한 추가 샘플링 비용은 실제 기기에서 확인해야 합니다.</td></tr></table>'}
${['desktop', 'mobile'].map(size => `<h2>${size === 'desktop' ? '가로 960×600' : '세로 390×564 · PC의 화면 비율 비교'}</h2>${Object.entries(views).map(([view,label]) => `<figure><figcaption>${label}</figcaption><div class="labels"><span>보정 전 시제품</span><span>보정 후 시제품</span></div><a href="${size}-${view}.jpg"><img loading="lazy" src="${size}-${view}.jpg" alt="${label} CPU 렌더, 왼쪽 보정 전 오른쪽 보정 후"></a></figure>`).join('')}<p><a href="${size}-verification.json">같은 구도·조명·그림자·접지·탐색 안정성 검사</a></p>`).join('')}
<h2>검증과 남은 확인</h2><p>이전 원본과 비교해 기존 잔디 모드의 12개 구도는 픽셀까지 동일합니다. 새 잔디도 코스 전체 구도는 동일합니다. 수목 배치·기하와 공·홀·깃발·샘플 궤적·좌표·높이·시간을 보존했고, 보호 대상 소스 해시도 일치합니다. 정지 화면을 다시 렌더하거나 다른 재생 위치에서 돌아온 뒤에도 동일한 화면이 나오는지 검사했습니다. 원래 비교 자료는 별도로 보존했습니다.</p>
${depthStudy ? '<p>입체 잎을 숨긴 렌더와 표면 깊이를 끈 렌더를 별도로 비교해 두 요소가 실제 화면에 기여하는지 검사했습니다. 극근접의 단순한 잎 단면, 촘촘한 구간의 경계와 움직일 때의 윤곽은 실제 화면에서 추가 판단해야 합니다.</p>' : ''}
<p>${depthStudy ? '가장 가까운 잎의 단면과 저해상도 윤곽에는 아직 보정 여지가 있습니다.' : '근접에서는 잎 다발이 아직 성기게 보일 수 있고 저해상도 윤곽과 먼 표면의 질감 전환은 추가 관찰이 필요합니다.'} 실제 브라우저의 재생·정지·탐색·카메라 이동·PNG 저장 및 움직일 때의 깜박임은 검증하지 못했습니다. 기존 개인 Chrome 창을 읽는 작업은 자동 승인 검토에서 차단됐고 작업 전용 브라우저 연결도 없었습니다. 모바일 실기기의 FPS·GPU 시간·메모리도 미측정입니다. 퍼팅은 기존 5.15초 화면 확인용 샘플입니다.</p>
<p><a href="status.json">전후 비교 검증 JSON</a> · <a href="../${previousName}/index.html">이전 비교 자료</a></p></html>`;
for (const target of [root, publicRoot]) await writeFile(resolve(target, 'index.html'), html);
console.log('Grass refinement: 12 before/after pairs, unchanged legacy pixels, matched cameras/shot/trees; original report preserved.');
