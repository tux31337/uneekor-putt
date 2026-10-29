import { useEffect, useRef, useState } from 'react';
import { PuttingScene, type CameraView, type PerformanceResult } from '../scene/PuttingScene';
import { ENVIRONMENT_LABELS, type EnvironmentMode } from '../scene/CourseEnvironment';
import { DEFAULT_GREEN, DEFAULT_VIEW, makeSampleTrajectory } from '../core/trajectory';
import './vegetation-review.css';

const sizes = { desktop: [960, 600], mobile: [390, 564] } as const;
const views = { ball: '공 뒤', perspective: '전체', top: '탑뷰' } as const;
type Size = keyof typeof sizes;
type ReviewView = keyof typeof views;
type Shot = { name: string; url: string; file: string };
type Result = PerformanceResult & { repeat: number; device: string; targetFps: number; targetReached: boolean };
const modes: EnvironmentMode[] = ['original', 'images', 'hybrid'];

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export default function VegetationReview() {
  const [size, setSize] = useState<Size>(() => window.innerWidth < 650 ? 'mobile' : 'desktop');
  const [mode, setMode] = useState<EnvironmentMode>('hybrid');
  const [camera, setCamera] = useState<ReviewView>('ball');
  const [focusTree, setFocusTree] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('동일한 그린·카메라·조명으로 비교합니다.');
  const [repeat, setRepeat] = useState(1);
  const [device, setDevice] = useState('이 PC · 가로/세로 화면');
  const [results, setResults] = useState<Result[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [video, setVideo] = useState<Shot>();
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<PuttingScene | null>(null);
  const generation = useRef(0);
  const animation = useRef(0);
  const stopRecording = useRef<(() => void) | undefined>(undefined);
  const cancelled = useRef(false);
  const urls = useRef<string[]>([]);

  async function createScene(nextSize: Size, nextMode: EnvironmentMode = 'hybrid', view: ReviewView = 'ball') {
    const element = host.current;
    if (!element) throw new Error('화면을 찾을 수 없습니다.');
    const token = ++generation.current;
    scene.current?.dispose(); scene.current = null; setReady(false);
    const [width, height] = sizes[nextSize];
    element.style.width = `${width}px`; element.style.height = `${height}px`;
    setSize(nextSize); setMode(nextMode); setCamera(view);
    return new Promise<PuttingScene>((resolve, reject) => {
      const instance = new PuttingScene(element, DEFAULT_GREEN, { ...DEFAULT_VIEW, quality: 'high' }, makeSampleTrajectory(DEFAULT_GREEN), {
        onReady: () => { if (token === generation.current) { instance.setCamera(view, false); setReady(true); resolve(instance); } },
        onProgress() {}, onComplete() {}, onStats() {},
        onError: error => { if (error && token === generation.current) { setMessage(error); reject(new Error(error)); } },
      }, { environment: nextMode, fixedPixelRatio: 1 });
      scene.current = instance;
    });
  }

  useEffect(() => {
    cancelled.current = false;
    void createScene(size).catch(error => setMessage(String(error)));
    return () => { cancelled.current = true; generation.current++; stopRecording.current?.(); cancelAnimationFrame(animation.current); scene.current?.dispose(); urls.current.forEach(URL.revokeObjectURL); };
    // The review owns the scene dimensions explicitly, independent of window DPR.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function withBusy(task: () => Promise<void>) {
    setBusy(true);
    try { await task(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (!cancelled.current) setBusy(false); }
  }
  async function changeMode(value: EnvironmentMode) { await withBusy(async () => { await scene.current?.setEnvironment(value); setMode(value); }); }
  async function capture(label: string, instance = scene.current!) {
    const blob = await instance.captureFrame();
    const url = URL.createObjectURL(blob); urls.current.push(url);
    const shot = { name: label, url, file: `${label.replace(/[^a-z0-9-]/gi, '-')}.png` };
    setShots(current => [...current, shot]);
  }
  async function captureComparison() {
    await withBusy(async () => {
      const instance = scene.current!;
      instance.seek(0); instance.setReviewOrbit(camera, 0, focusTree);
      for (const variant of modes) {
        await instance.setEnvironment(variant); setMode(variant);
        await capture(`${size}-${variant}-${camera}${focusTree ? '-tree' : ''}`, instance);
      }
      setMessage('동일한 카메라·해상도의 실제 브라우저 PNG 3개를 아래에서 확인하세요.');
    });
  }

  async function benchmark(all: boolean) {
    await withBusy(async () => {
      const collected: Result[] = [];
      setFocusTree(false);
      const testSizes: Size[] = all ? ['desktop', 'mobile'] : [size];
      const testViews: ReviewView[] = all ? ['ball', 'perspective', 'top'] : [camera];
      const total = testSizes.length * testViews.length * modes.length * repeat;
      let completed = 0;
      for (const testSize of testSizes) {
        const instance = await createScene(testSize, 'original', testViews[0]);
        for (const view of testViews) for (let trial = 0; trial < repeat; trial++) {
          const order = modes.map((_, index) => modes[(index + trial) % modes.length]);
          for (const variant of order) {
            if (cancelled.current) return;
            await instance.setEnvironment(variant); setMode(variant); setCamera(view);
            instance.setCamera(view, false);
            setMessage(`${completed + 1}/${total} · ${sizes[testSize].join('×')} · ${views[view]} · ${ENVIRONMENT_LABELS[variant]} · 준비 1.5초 + 재생 6초`);
            const result = await instance.measurePlayback(6000, 1500);
            instance.pause();
            const targetFps = testSize === 'desktop' ? 60 : 30;
            collected.push({ ...result, repeat: trial + 1, device, targetFps, targetReached: result.fps >= targetFps && result.p95Ms <= 1000 / targetFps * 1.1 });
            setResults([...collected]); completed++;
          }
        }
        instance.seek(0); instance.setCamera(testViews.at(-1)!, false);
      }
      setMessage(`${collected.length}회 측정 완료. FPS는 이 브라우저의 결과입니다. PC의 세로 화면은 모바일 실기기 결과가 아닙니다.`);
    });
  }

  async function recordOrbit() {
    await withBusy(async () => {
      const instance = scene.current!, canvas = instance.getCanvas();
      instance.pause(); instance.seek(0);
      const supported = typeof MediaRecorder !== 'undefined' && typeof canvas.captureStream === 'function';
      const type = supported ? ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) : undefined;
      const stream = type ? canvas.captureStream(30) : undefined;
      const recorder = stream && type ? new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 }) : undefined;
      const chunks: BlobPart[] = [];
      stopRecording.current = () => { if (recorder?.state === 'recording') recorder.stop(); stream?.getTracks().forEach(track => track.stop()); };
      if (recorder) { recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); }; recorder.start(); }
      setMessage(`${ENVIRONMENT_LABELS[mode]} · ${views[camera]} · 12초 동안 360° 회전합니다.`);
      const start = performance.now();
      await new Promise<void>(resolve => {
        const frame = (now: number) => {
          if (cancelled.current) { resolve(); return; }
          const progress = Math.min(1, (now - start) / 12000);
          instance.setReviewOrbit(camera as CameraView, progress * Math.PI * 2, focusTree);
          if (progress < 1) animation.current = requestAnimationFrame(frame); else resolve();
        };
        animation.current = requestAnimationFrame(frame);
      });
      if (recorder) {
        await new Promise<void>(resolve => { recorder.onstop = () => resolve(); recorder.stop(); });
        const blob = new Blob(chunks, { type });
        const url = URL.createObjectURL(blob); urls.current.push(url);
        setVideo({ name: `${size}-${mode}-${camera}-browser-orbit`, url, file: `${size}-${mode}-${camera}-browser-orbit.webm` });
      }
      stream?.getTracks().forEach(track => track.stop());
      stopRecording.current = undefined;
      setMessage(recorder ? '현재 브라우저의 회전 영상을 아래에서 재생·저장할 수 있습니다.' : '회전 완료. 이 브라우저에서는 영상 저장을 지원하지 않습니다.');
    });
  }

  return <main className="vegetation-review">
    <header className="review-header"><div><a href="./" className="review-back">← 퍼팅 연습으로</a><p className="eyebrow">COURSE STUDY / 01</p><h1>나무가 만드는 코스의 깊이<span>.</span></h1><p>기존 · A 전체 이미지 · B 주요 나무 3D + 중경 이미지 + 원경 군락</p></div><span className="review-badge">교체 시제품</span></header>
    <section className="review-controls" aria-label="비교 조건">
      <div className="environment-options">{modes.map(value => <button key={value} disabled={!ready || busy} aria-pressed={mode === value} onClick={() => void changeMode(value)}>{ENVIRONMENT_LABELS[value]}</button>)}</div>
      <label>해상도<select value={size} disabled={busy || !ready} onChange={event => void withBusy(async () => { const instance = await createScene(event.target.value as Size, mode, camera); instance.setReviewOrbit(camera, 0, focusTree); })}><option value="desktop">PC 가로 · 960×600</option><option value="mobile">모바일 세로 · 390×564</option></select></label>
      <label>시점<select value={camera} disabled={busy || !ready} onChange={event => { const value = event.target.value as ReviewView; setCamera(value); scene.current?.setReviewOrbit(value, 0, focusTree); }}>{Object.entries(views).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label><input type="checkbox" checked={focusTree} disabled={busy || !ready} onChange={event => { setFocusTree(event.target.checked); scene.current?.setReviewOrbit(camera, 0, event.target.checked); }}/>주요 나무 근접 검사</label>
      <span className="review-fixed">DPR 1 · 고정 품질 · 같은 조명</span>
    </section>
    <div className="review-scene-scroll"><div className="review-scene" ref={host} style={{ width: sizes[size][0], height: sizes[size][1] }}/></div>
    <div className="review-status" role="status"><span className={`status-dot ${busy ? 'slow' : ''}`}/>{message}</div>
    <div className="review-actions"><button disabled={!ready || busy} onClick={() => void captureComparison()}>동일 구도 PNG 3개</button><button disabled={!ready || busy} onClick={() => void recordOrbit()}>360° 회전·영상 저장</button><button disabled={!ready || busy} onClick={() => scene.current?.play()}>공 궤적 재생</button></div>
    <section className="review-measure"><div><p className="eyebrow">MEASURE ON THIS DEVICE</p><h2>실제 브라우저 성능 비교</h2><p>자산을 불러온 뒤 1.5초 준비, 6초 연속 재생을 측정합니다. 정지 화면은 제외합니다.<br/>세로 해상도를 PC에서 실행한 결과는 모바일 실기기 성능으로 볼 수 없습니다.</p></div><div className="review-measure-options">
      <label>측정 기기<select value={device} disabled={busy} onChange={event => setDevice(event.target.value)}><option>이 PC · 가로/세로 화면</option><option>Android 실기기 브라우저</option><option>iOS 실기기 브라우저</option><option>실기기 WebView</option></select></label>
      <label>반복<select value={repeat} disabled={busy} onChange={event => setRepeat(Number(event.target.value))}><option value={1}>1회</option><option value={3}>3회 · 순서 교대</option></select></label>
      <button disabled={!ready || busy} onClick={() => void benchmark(false)}>현재 조건 3안 비교</button><button disabled={!ready || busy} onClick={() => void benchmark(true)}>두 해상도·세 시점 비교</button>
      {results.length > 0 && <button onClick={() => saveBlob(new Blob([JSON.stringify({ schema: 1, date: new Date().toISOString(), note: 'rAF frame intervals; renderSubmissionMs is CPU submission, NOT GPU time. Device label is supplied by the tester. Mobile viewport on PC is not mobile hardware.', results }, null, 2)], { type: 'application/json' }), 'vegetation-browser-performance.json')}>측정 JSON 저장</button>}
    </div></section>
    {results.length > 0 && <div className="review-table-scroll"><table><thead><tr><th>안</th><th>해상도·시점</th><th>FPS</th><th>p95</th><th>p99</th><th>CPU 제출</th><th>draws</th><th>삼각형</th></tr></thead><tbody>{results.map((result, index) => <tr key={index}><td>{ENVIRONMENT_LABELS[result.mode]}</td><td>{result.width}×{result.height} · {views[result.camera as ReviewView]}</td><td>{result.fps}</td><td>{result.p95Ms}ms</td><td>{result.p99Ms}ms</td><td>{result.renderSubmissionMs}ms</td><td>{result.drawCalls}</td><td>{result.triangles.toLocaleString()}</td></tr>)}</tbody></table><p>GPU 시간·투명 픽셀 겹침은 별도 측정하지 않습니다. 60Hz 화면에서는 FPS 상한도 함께 고려하세요.</p></div>}
    {shots.length > 0 && <section className="review-gallery"><h2>이 브라우저에서 얻은 비교 화면</h2><div>{shots.map((shot, index) => <figure key={index}><img src={shot.url} alt={shot.name}/><figcaption>{shot.name}<a href={shot.url} download={shot.file}>PNG 저장</a></figcaption></figure>)}</div></section>}
    {video && <section className="review-video"><h2>이 브라우저의 360° 회전</h2><video src={video.url} controls loop playsInline/><a href={video.url} download={video.file}>WebM 저장</a></section>}
    <section className="review-reference"><p className="eyebrow">OFFLINE VISUAL REFERENCE</p><h2>CPU 렌더 참고 화면</h2><p>아래는 CPU로 만든 외형 참고입니다. 실제 브라우저 화면·실기기 FPS와 구분합니다.</p><img src={`${import.meta.env.BASE_URL}vegetation/review-desktop.jpg`} alt="기존·A·B의 공 뒤·전체·탑뷰 CPU 참고 비교" loading="lazy"/><img src={`${import.meta.env.BASE_URL}vegetation/review-mobile.jpg`} alt="모바일 세로 비율 CPU 참고 비교" loading="lazy"/></section>
    <footer className="review-notes"><strong>이전 A/B 비교 기록 · 수목 품질 미승인</strong><p>A와 B는 같은 자동생성 원본을 사용합니다. 사용자는 가지 형태와 재질이 여전히 조잡하고 어색하다고 평가했습니다. B는 품질이 승인된 결과가 아닙니다. <a href="?review=tree">외부 수목 한 그루의 새 비교 화면</a>에서 원본 모델의 품질을 검토합니다.</p><p>PC·모바일 실기기 성능은 미측정입니다. <a href={`${import.meta.env.BASE_URL}vegetation/LICENSE.txt`}>이전 생성 자산 고지</a></p></footer>
  </main>;
}
