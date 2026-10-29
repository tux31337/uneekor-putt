import { readFile, writeFile, mkdir, cp, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
if (process.platform === 'win32' && !process.env.FONTCONFIG_FILE) {
  const cache = resolve('.tmp/vegetation-font-cache').replaceAll('\\', '/');
  await mkdir(cache, { recursive: true });
  const config = resolve('.tmp/vegetation-fonts.conf');
  await writeFile(config, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>C:/Windows/Fonts</dir><cachedir>${cache}</cachedir></fontconfig>`);
  process.env.FONTCONFIG_FILE = config;
}
const sharp = (await import(pathToFileURL(require.resolve('sharp', { paths: [resolve('node_modules/@drawcall/webgl')] })).href)).default;
const root = resolve('artifacts/tree-quality-review');
const asset = resolve('public/vegetation/external/tree-small-02');
const provenance = JSON.parse(await readFile(resolve(asset, 'provenance.json'), 'utf8'));
const views = { whole: '나무 전체', branches: '줄기·가지 연결', bark: '껍질 근접', roots: '밑동·접지', top: '탑뷰', course: '코스와 한 그루' };
const english = { whole: 'WHOLE TREE', branches: 'BRANCH CONNECTIONS', bark: 'BARK DETAIL', roots: 'GROUND CONTACT', top: 'TOP VIEW', course: 'IN THE COURSE' };
await mkdir(root, { recursive: true });
const verification = {};
for (const size of ['desktop', 'mobile']) {
  const data = JSON.parse(await readFile(resolve(root, 'cpu', size, 'verification.json'), 'utf8'));
  verification[size] = data;
  assert.equal(data.sharedCameraAndLighting, true);
  assert.equal(data.preservedPuttingData, true);
  assert.equal(data.metrics.length, 12);
  const [width, height] = data.resolution;
  const svg = text => Buffer.from(`<svg width="${width}" height="64" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#edf2e6"/><text x="16" y="26" font-family="Arial,sans-serif" font-size="15" fill="#294831" font-weight="600">${text}</text><text x="16" y="48" font-family="Arial,sans-serif" font-size="11" fill="#687d61">CPU REFERENCE ONLY / ${width} x ${height} / SAME CAMERA + LIGHT</text></svg>`);
  for (const [view, label] of Object.entries(english)) {
    const layers = [];
    for (const [i, variant] of ['current', 'external'].entries()) {
      const file = resolve(root, 'cpu', size, variant, `${view}.png`);
      const metadata = await sharp(file).metadata();
      assert.equal(metadata.width, width); assert.equal(metadata.height, height);
      layers.push({ input: svg(`${variant === 'current' ? 'CURRENT / GENERATED' : 'NEW / POLY HAVEN'} / ${label}`), top: 0, left: i * width });
      layers.push({ input: file, top: 64, left: i * width });
    }
    await sharp({ create: { width: width * 2, height: height + 64, channels: 3, background: '#edf2e6' } })
      .composite(layers).jpeg({ quality: 95 }).toFile(resolve(root, `${size}-${view}.jpg`));
  }
  for (const variant of ['current', 'external']) {
    const rotation = JSON.parse(await readFile(resolve(root, 'cpu', size, variant, 'orbit.json'), 'utf8'));
    assert.equal(rotation.fullRotation, true); assert.equal(rotation.frameCount, 33);
    assert.equal(rotation.rotation, 'tree rotates in place; fixed camera and sunlight');
    assert.deepEqual(rotation.rotations[0].camera, rotation.rotations.at(-1).camera);
    const gif = await sharp(resolve(root, 'cpu', size, variant, 'orbit.gif'), { animated: true }).metadata();
    assert.equal(gif.pages, 33); assert.equal(gif.width, width); assert.equal(gif.pageHeight, height);
  }
}
const external = verification.desktop.metrics.find(m => m.name === 'external');
assert.equal(external.externalTrees.length, 1);
const tree = external.externalTrees[0];
await copyFile(resolve(asset, 'provenance.json'), resolve(root, 'asset-provenance.json'));
await copyFile(resolve(asset, 'LICENSE.txt'), resolve(root, 'asset-LICENSE.txt'));
await copyFile('.references/tree-small-02/publisher-front.png', resolve(root, 'publisher-front.png'));
await copyFile('.references/tree-small-02/publisher-top.png', resolve(root, 'publisher-top.png'));
const triangles = provenance.primitives.reduce((sum, p) => sum + p.triangles, 0);
const gallery = ['desktop', 'mobile'].map(size => `<section><h2>${size === 'desktop' ? 'PC 가로 960×600' : '모바일 세로 비율 390×564'}</h2><p>동일 해상도·DPR 1·고정 품질. 왼쪽은 현재 자동생성 원본, 오른쪽은 새 외부 수목입니다. PNG 원본은 각 이미지 아래 링크에서 확인할 수 있습니다.</p>${Object.entries(views).map(([view, label]) => `<details${view === 'whole' || view === 'branches' ? ' open' : ''}><summary>${label}</summary><a href="${size}-${view}.jpg"><img src="${size}-${view}.jpg" alt="${label} / CPU 참고 비교" loading="lazy"/></a><p><a href="cpu/${size}/current/${view}.png">현재 나무 PNG</a> · <a href="cpu/${size}/external/${view}.png">새 수목 PNG</a></p></details>`).join('')}
<h3>360° 제자리 회전 · 고정 카메라</h3><p>각각 33개 CPU 렌더 프레임입니다. 실제 브라우저 녹화가 아닙니다. 나무만 회전하며 코스·카메라·태양은 고정됩니다. 인접 나무로 인한 가림을 피하면서 모든 면의 형태와 명암을 검토합니다.</p><div class="turntables">${['current', 'external'].map(name => `<figure><figcaption>${name === 'current' ? '현재 · 자동생성' : '새 모델 · Tree Small 02'}</figcaption><img src="cpu/${size}/${name}/orbit.gif" alt="CPU 참고 360도 회전" loading="lazy"/><a href="cpu/${size}/${name}/orbit.gif">원본 GIF</a> · <a href="cpu/${size}/${name}/orbit-strip.jpg">8방향 모음</a></figure>`).join('')}</div><p><a href="cpu/${size}/verification.json">동일 조건·퍼팅 데이터 보존 검증 JSON</a></p></section>`).join('');

const status = { scope: 'One external tree quality prototype, no quality approval inferred',
  model: provenance.source, author: provenance.author, license: provenance.license,
  position: tree.position, displayedHeight: tree.displayHeight, uniformScale: tree.uniformScale,
  sourceNativeHeight: tree.nativeHeight, triangles, bytes: provenance.bytes,
  browserCaptures: [], browserCaptureStatus: 'blocked: Windows Computer Use could not verify the current Chrome URL',
  cpuReference: { stills: 24, turntables: 4, framesPerTurntable: 33, resolution: [[960, 600], [390, 564]] },
  realDeviceFps: null, performanceOptimization: 'deferred',
  preserved: ['ball, cup and flag positions', 'trajectory coordinates, heights and timestamps', 'putting heightAt and slope calculations', 'gameplay camera presets'],
  limitations: ['Original asset has no exposed root network', 'Fine foliage can alias at fixed DPR 1', 'Surrounding trees remain previous generated prototypes', 'Browser, React layout and device FPS remain unverified'],
};
await writeFile(resolve(root, 'status.json'), JSON.stringify(status, null, 2) + '\n');
await writeFile(resolve(root, 'index.html'), `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>한 그루 수목 품질 비교</title><style>
body{margin:0;background:#f4f6ef;color:#283f2d;font:15px/1.9 system-ui,'Malgun Gothic',sans-serif}main{max-width:1280px;margin:auto;padding:38px 26px 80px}h1{font-size:34px;line-height:1.4}h2{font-size:24px;margin-top:34px}h3{font-size:19px}p{color:#667960}a{color:#36663c}img{max-width:100%;height:auto;display:block;margin:12px 0;background:#e0e7d8}section{border-bottom:1px solid #d8e0d0;padding:12px 0 30px}.notice{background:#e4ecd9;padding:20px 24px;border-radius:10px}.notice strong{font-size:18px}.notice p{margin:6px 0}.evidence{background:#fff5db;padding:15px 20px;border-radius:8px;margin:18px 0}details{border:1px solid #d7dfd0;border-radius:8px;padding:12px;margin:15px 0}summary{cursor:pointer;font-weight:600}.turntables{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0}figcaption{font-weight:600}.stamp{font-size:12px;letter-spacing:1.5px;color:#87977b}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #dde3d5;padding:10px;font-size:13px}th{width:160px;font-weight:600}li{margin:7px 0}.run{display:inline-block;background:#31553a;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none}.publisher{display:flex;max-height:420px;gap:25px}.publisher img{object-fit:contain;min-width:0;max-width:48%;background:#dae3d1}@media(max-width:650px){main{padding:22px 12px 50px}h1{font-size:27px}.turntables{grid-template-columns:1fr}th{width:100px}}
</style><main><p class="stamp">PUTTING LAB / ONE TREE / 2026.10.27</p><h1>한 그루의 형태와 재질부터</h1>
<div class="notice"><strong>외부 수목 한 그루 시제품 · 품질 승인 전</strong><p>기존 A/B는 같은 자동생성 나무를 사용했고 사용자 품질 기준에 미달했습니다. 이 보고서는 B를 채택 결과로 취급하지 않습니다. 실제 외부 모델 한 종을 내려받아 기존 근접 나무 한 그루만 교체했습니다.</p><a class="run" href="http://127.0.0.1:5173/?review=tree">코스에서 직접 비교하기 ↗</a></div>
<div class="evidence"><strong>자료 구분</strong><p>아래 24개 정지 이미지와 4개 회전 GIF는 실제 PuttingScene의 <b>CPU 참고 렌더</b>입니다. 브라우저 캡처가 아닙니다. Windows 브라우저 도구가 현재 Chrome URL을 확인하지 못해 UI 조작이 중단됐습니다. 실제 브라우저 캡처·React 화면·Android/iOS 실기기 FPS는 미확인입니다.</p></div>
<section><h2>이미지를 보고 평가한 결과</h2><ul>
<li><b>가지 연결:</b> 기존의 반복적인 Y자·굵은 끝단과 끊긴 주가지 대신, 굽은 줄기에서 굵기가 줄어드는 가지와 잔가지가 이어집니다. 근접 구도에서 차이가 뚜렷합니다.</li>
<li><b>수관·잎:</b> 큰 삼각형 잎 다발 대신 잎 윤곽·잎맥·잎자루와 작은 가지 사이 틈이 보입니다. 탑뷰도 불규칙한 실제 입체 수관이며, 고정된 햇빛 아래 회전하면 밝은 면과 그늘이 달라집니다. DPR 1에서 미세 잎 가장자리의 거친 샘플링은 남습니다.</li>
<li><b>껍질:</b> 단색 각기둥에서 원본 색·노멀·거칠기·AO를 가진 껍질로 바뀌었습니다. 줄기 근접 화면에서 색 반점과 표면 결이 보입니다.</li>
<li><b>밑동·그림자:</b> 원본 밑동 중심을 지형에 정렬하고 3.5cm 묻었습니다. 기존 접촉 음영과 실제 메시의 태양 그림자를 함께 사용합니다. 원본은 노출 뿌리망이 없는 잘린 밑동이므로 큰 뿌리가 지표에 퍼지는 외형까지 확보한 것은 아닙니다.</li>
<li><b>남은 품질 차이:</b> 주변 자동생성 수목과 새 나무의 품질 격차가 보입니다. 이번에는 주변 나무·군락 이미지를 교체하지 않았습니다. 한 그루의 형태·재질 개선은 CPU 자료에서 확인되지만 최종 품질 승인과 브라우저 확인은 남습니다.</li></ul></section>
${gallery}
<section><h2>원본 자산과 이용 조건</h2><table><tr><th>자산·제작자</th><td><a href="${provenance.source}">Tree Small 02</a> · Rico Cilliers / Poly Haven</td></tr><tr><th>라이선스</th><td>CC0 1.0 Universal · 무료, 상업적 사용·수정·재배포 가능. <a href="https://polyhaven.com/license">공식 고지</a> · <a href="https://creativecommons.org/publicdomain/zero/1.0/legalcode">CC0 원문</a></td></tr><tr><th>배포 파일</th><td>원본 glTF 2K + BIN + PBR 9장 + 원본 잎 알파 PNG. 각 다운로드의 제공자 MD5 일치 검증.</td></tr><tr><th>원본 형태</th><td>${triangles.toLocaleString('en')} triangles · 원본 glTF의 실제 높이 ${tree.nativeHeight.toFixed(3)}m · 가지·UV·노멀 보존. 토폴로지 단순화 없음.</td></tr><tr><th>코스 배치</th><td>x = −11m, z = 27m, y = courseHeightAt. 기존 나무와 높이를 ${tree.displayHeight.toFixed(3)}m로 맞추기 위해 ${tree.uniformScale.toFixed(4)}배 균일 확대. 형태 비율은 유지.</td></tr><tr><th>파일 크기</th><td>${(provenance.bytes / 1048576).toFixed(2)} MiB GLB. 한 그루의 품질 확인용 원본이며 다량 배치·본격 성능 최적화는 범위 밖.</td></tr></table>
<p>출처 증빙: <a href="asset-LICENSE.txt">자산 고지</a> · <a href="asset-provenance.json">원본 URL·체크섬·변환 내역</a> · <a href="status.json">검증 범위와 미확인 항목</a></p><h3>제공자의 정면·탑뷰 참고</h3><p>아래 두 장만 Poly Haven의 원본 소개 이미지입니다. 위 코스 렌더와 구분합니다.</p><div class="publisher"><img src="publisher-front.png" alt="Poly Haven 제공 원본 정면" loading="lazy"/><img src="publisher-top.png" alt="Poly Haven 제공 원본 탑뷰" loading="lazy"/></div></section>
<section><h2>변환과 장면 적용</h2><ol><li>원본 BIN을 바이트 그대로 보존해 GLB에 포함했습니다. 원본 메시의 가지 수·잎 수·랜덤값을 바꾸지 않았습니다.</li><li>원본 잎 diffuse RGB와 누락된 원본 alpha PNG를 합쳐 RGBA PNG로 저장했습니다. alpha mask 0.45와 MSAA alpha-to-coverage를 사용해 잎과 태양 그림자에 같은 윤곽을 적용합니다.</li><li>원본 OpenGL normal과 ARM을 유지했습니다. ARM의 R을 AO로 연결하고 강도는 잎 0.65, 목질 0.85입니다. 원본 UV 채널과 KHR_texture_transform을 보존했습니다.</li><li>기존 여섯 근접 나무 중 한 그루만 교체했습니다. 빛의 방향·색·세기는 유지하고, 태양 그림자 범위를 그린과 대상 수목까지 넓혀 4096 맵을 사용합니다. 두 비교안에 동일하게 적용했습니다.</li></ol><p>공·홀·깃발 위치, 외부 궤적 좌표·제공 높이·시간, 퍼팅 평면과 경사 계산, 게임의 기본 카메라는 유지합니다. 비교용 보조 카메라만 추가했습니다. 새 장면의 성능 수치는 측정하지 않았습니다.</p></section></main></html>`);
await mkdir('public/vegetation/tree-review', { recursive: true });
await cp(root, 'public/vegetation/tree-review', { recursive: true });
// Keep historical comparison pages from being mistaken for an approved result.
for (const file of ['scripts/prepare-vegetation-report.mjs', 'artifacts/vegetation-review/index.html']) {
  let previous = await readFile(file, 'utf8');
  previous = previous.replace('형태 기준의 잠정 권장안: B · 주요 나무 3D 혼합', '이전 A/B 기록 · 사용자 수목 품질 미승인');
  previous = previous.replace('<p>낮게 갈라지는 가지, 비대칭 수관, 관목과 빈 공간을 배치했습니다.',
    '<p><b>A와 B는 같은 자동생성 나무를 쓰며, 사용자는 형태와 재질이 여전히 조잡하고 어색하다고 평가했습니다. B는 승인된 결과가 아닙니다. <a href="http://127.0.0.1:5173/?review=tree">외부 수목 한 그루 비교</a>를 먼저 확인하세요.</b></p><p>이전 작업에서 가지·수관·관목과 빈 공간을 배치했습니다.');
  await writeFile(file, previous);
}
const previousStatus = JSON.parse(await readFile('artifacts/vegetation-review/status.json', 'utf8'));
previousStatus.recommendation = { mode: null, status: 'NOT APPROVED: user rejected generated tree shape and materials; see the single external-tree study' };
await writeFile('artifacts/vegetation-review/status.json', JSON.stringify(previousStatus, null, 2) + '\n');
console.log(`Prepared ${resolve(root, 'index.html')} — 24 stills, 4 CPU turntables, provenance and same-camera verification`);
