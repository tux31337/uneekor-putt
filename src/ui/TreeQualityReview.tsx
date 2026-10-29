import { useEffect, useRef, useState } from 'react';
import { PuttingScene, type TreeInspectionView } from '../scene/PuttingScene';
import type { EnvironmentMode } from '../scene/CourseEnvironment';
import { DEFAULT_GREEN, DEFAULT_VIEW, makeSampleTrajectory } from '../core/trajectory';
import type { PlaybackPhase } from '../core/playback';
import { RollBallButton } from './RollBallButton';
import './vegetation-review.css';
import './tree-quality-review.css';

const sizes = { desktop: [960, 600], mobile: [390, 564] } as const;
type ReviewView = TreeInspectionView | 'putting';
const views: Record<ReviewView, string> = { whole: '나무 전체', branches: '줄기와 가지 연결', bark: '나무껍질', roots: '밑동 접지', top: '탑뷰', course: '실제 코스', putting: '퍼팅 · 공 보기' };
const sampleTrajectory = makeSampleTrajectory(DEFAULT_GREEN);
const variants = [{ mode: 'hybrid', label: '현재 · 자동생성 나무', file: 'current' },
  { mode: 'specimen', label: '새 모델 · 외부 수목 한 그루', file: 'external' }] as const;
type Size = keyof typeof sizes;
type Capture = { label: string; url: string; file: string; video?: boolean };

function setReviewCamera(instance: PuttingScene, view: ReviewView, angle = 0) {
  if (view === 'putting') instance.setAutoCamera(true, false);
  else instance.setTreeInspection(view, angle);
}

export default function TreeQualityReview() {
  const [size, setSize] = useState<Size>(() => window.innerWidth < 650 ? 'mobile' : 'desktop');
  const [mode, setMode] = useState<EnvironmentMode>('specimen');
  const [view, setView] = useState<ReviewView>('whole');
  const [angle, setAngle] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<PlaybackPhase>('ready');
  const [message, setMessage] = useState('외부 수목과 원본 재질을 불러오고 있습니다.');
  const [captures, setCaptures] = useState<Capture[]>([]);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<PuttingScene | null>(null);
  const generation = useRef(0);
  const cancelled = useRef(false);
  const animation = useRef(0);
  const cleanupRecording = useRef<(() => void) | undefined>(undefined);
  const urls = useRef<string[]>([]);

  function createScene(nextSize: Size, nextMode: EnvironmentMode, nextView: ReviewView) {
    const element = host.current!;
    const token = ++generation.current;
    scene.current?.dispose(); scene.current = null; setReady(false);
    const [width, height] = sizes[nextSize];
    element.style.width = `${width}px`; element.style.height = `${height}px`;
    setSize(nextSize); setAngle(0); setPlaying(false); setProgress(0); setPhase('ready');
    return new Promise<PuttingScene>((resolve, reject) => {
      const instance = new PuttingScene(element, DEFAULT_GREEN, { ...DEFAULT_VIEW, quality: 'high' }, sampleTrajectory, {
        onReady: () => {
          if (token !== generation.current) return;
          setReviewCamera(instance, nextView); setReady(true);
          setMessage('공 굴리기를 누르면 공을 따라가는 시점으로 재생합니다.'); resolve(instance);
        },
        onProgress: value => { if (token === generation.current) setProgress(value); },
        onPlayingChange: value => { if (token === generation.current) setPlaying(value); },
        onPhaseChange: value => { if (token === generation.current) setPhase(value); },
        onComplete: () => { if (token === generation.current) setMessage('퍼팅이 끝났습니다. 다시 굴리기를 누르면 처음부터 재생합니다.'); },
        onStats() {},
        onError: error => { if (error && token === generation.current) { setReady(false); setMessage(error); reject(new Error(error)); } },
      }, { environment: nextMode, fixedPixelRatio: 1 });
      scene.current = instance;
    });
  }
  useEffect(() => {
    cancelled.current = false;
    void createScene(size, 'specimen', 'whole').catch(error => setMessage(String(error)));
    return () => { cancelled.current = true; generation.current++; cleanupRecording.current?.(); cancelAnimationFrame(animation.current);
      scene.current?.dispose(); urls.current.forEach(URL.revokeObjectURL); };
    // Explicit dimensions belong to this inspector, independently of browser DPR.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    try { await task(); } catch (error) { if (!cancelled.current) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (!cancelled.current) setBusy(false); }
  }
  function toggleRoll() {
    const instance = scene.current;
    if (!instance || !ready || busy) return;
    if (playing) { instance.pause(); setMessage('일시정지했습니다. 이어서 굴리기로 계속할 수 있습니다.'); }
    else {
      setView('putting'); setAngle(0); instance.rollBall();
      setMessage('공이 굴러갑니다. 공과 홀을 함께 보여주는 자동 시점입니다.');
    }
  }
  function resetBall() {
    const instance = scene.current;
    if (!instance) return;
    instance.seek(0); setReviewCamera(instance, view, angle / 180 * Math.PI);
    setMessage('공을 시작 위치로 돌렸습니다. 공 굴리기를 눌러 재생하세요.');
  }
  function changeView(next: ReviewView) {
    const instance = scene.current;
    if (!instance) return;
    instance.seek(0); setView(next); setReviewCamera(instance, next, angle / 180 * Math.PI);
    setMessage(next === 'putting' ? '공 굴리기를 눌러 퍼팅을 시작하세요.' : '공 재생을 멈추고 나무를 확인합니다.');
  }
  function addCapture(blob: Blob, label: string, file: string, video = false) {
    const url = URL.createObjectURL(blob); urls.current.push(url);
    setCaptures(current => [...current, { label, file, url, video }]);
  }
  async function capturePairs(allViews: boolean) {
    await run(async () => {
      const instance = scene.current!;
      instance.pause(); instance.seek(0);
      for (const camera of allViews ? Object.keys(views) as ReviewView[] : [view]) {
        let reference = '';
        for (const variant of variants) {
          if (cancelled.current) return;
          await instance.setEnvironment(variant.mode); setMode(variant.mode);
          setReviewCamera(instance, camera, allViews ? 0 : angle / 180 * Math.PI); setView(camera);
          const state = instance.getReviewState();
          const comparable = JSON.stringify([state.cameraMatrix, state.projectionMatrix, state.ball, state.elapsed, state.green, state.width, state.height, state.pixelRatio]);
          if (!reference) reference = comparable;
          else if (comparable !== reference) throw new Error('카메라 또는 퍼팅 상태가 달라 비교 저장을 중단했습니다.');
          addCapture(await instance.captureFrame(), `${variant.label} · ${views[camera]} · 실제 브라우저`, `${size}-${variant.file}-${camera}-browser.png`);
        }
      }
      if (allViews) setAngle(0);
      setMessage('이 브라우저에서 만든 PNG입니다. 아래 CPU 참고 렌더와 구분해 저장합니다.');
    });
  }
  async function recordOrbit() {
    await run(async () => {
      const instance = scene.current!;
      const canvas = instance.getCanvas();
      instance.pause(); instance.seek(0); instance.setTreeInspection('whole'); setView('whole'); setAngle(0);
      const type = typeof MediaRecorder === 'undefined' ? undefined : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
      const stream = type && typeof canvas.captureStream === 'function' ? canvas.captureStream(30) : undefined;
      const recorder = stream && type ? new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 5_000_000 }) : undefined;
      const chunks: BlobPart[] = [];
      cleanupRecording.current = () => { if (recorder?.state === 'recording') recorder.stop(); stream?.getTracks().forEach(track => track.stop()); };
      try {
        if (recorder) { recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); }; recorder.start(); }
        setMessage('고정된 카메라에서 나무를 12초 동안 360° 회전합니다.');
        const start = performance.now();
        await new Promise<void>((resolve, reject) => {
          const frame = (now: number) => {
            if (cancelled.current) { reject(new Error('회전을 중단했습니다.')); return; }
            if (document.hidden) { reject(new Error('탭이 숨겨져 회전 녹화를 중단했습니다. 다시 실행해 주세요.')); return; }
            const progress = Math.min(1, (now - start) / 12000);
            instance.setTreeInspection('whole', progress * Math.PI * 2);
            setAngle(Math.round(progress * 360));
            if (progress < 1) animation.current = requestAnimationFrame(frame); else resolve();
          };
          animation.current = requestAnimationFrame(frame);
        });
        if (recorder) {
          await new Promise<void>(resolve => { recorder.onstop = () => resolve(); recorder.stop(); });
          addCapture(new Blob(chunks, { type }), `${mode === 'specimen' ? '새 모델' : '현재 나무'} · 실제 브라우저 360°`, `${size}-${mode}-browser-orbit.webm`, true);
        }
        setMessage(recorder ? '이 브라우저의 회전 영상을 아래에서 확인할 수 있습니다.' : '360° 회전 완료. 현재 브라우저는 영상 저장을 지원하지 않습니다.');
      } finally { cleanupRecording.current?.(); cleanupRecording.current = undefined; }
    });
  }

  const referenceRoot = `${import.meta.env.BASE_URL}vegetation/tree-review`;
  const cleanupRoot = `${import.meta.env.BASE_URL}vegetation/tree-cleanup-review/cpu`;
  return <main className="vegetation-review tree-quality-review">
    <header className="review-header"><div><a href="./" className="review-back">← 퍼팅 코스로</a><p className="eyebrow">ONE TREE / QUALITY STUDY</p><h1>한 그루의 형태부터<span>.</span></h1><p>현재 자동생성 나무와 외부 수목 원본을 같은 코스에서 비교합니다.</p></div><span className="review-badge">품질 검토 시제품</span></header>
    <section className="review-controls" aria-label="나무 비교 조건">
      <div className="environment-options">{variants.map(variant => <button key={variant.mode} disabled={!ready || busy || playing} aria-pressed={mode === variant.mode} onClick={() => void run(async () => {
        await scene.current!.setEnvironment(variant.mode); setMode(variant.mode); setReviewCamera(scene.current!, view, angle / 180 * Math.PI);
      })}>{variant.label}</button>)}</div>
      <label>화면<select value={size} disabled={!ready || busy || playing} onChange={event => void run(async () => { await createScene(event.target.value as Size, mode, view); })}><option value="desktop">PC 가로 · 960×600</option><option value="mobile">모바일 세로 · 390×564</option></select></label>
      <label>시점<select value={view} disabled={!ready || busy} onChange={event => changeView(event.target.value as ReviewView)}>{Object.entries(views).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>나무 회전<input type="range" min="0" max="360" value={angle} disabled={!ready || busy || view === 'course' || view === 'putting'} onChange={event => { const value = Number(event.target.value); setAngle(value); if (view !== 'putting') scene.current?.setTreeInspection(view, value / 180 * Math.PI); }}/>{angle}°</label>
      <span className="review-fixed">고정 DPR 1 · 같은 코스 조명</span>
    </section>
    <section className="tree-playback-controls" aria-label="공 재생 조작">
      <div className="tree-playback-buttons">
        <RollBallButton playing={playing} phase={phase} disabled={!ready || busy} onClick={toggleRoll}/>
        <button type="button" disabled={!ready || busy} onClick={resetBall}>처음으로</button>
        <button type="button" disabled={!ready || busy} onClick={() => changeView('whole')}>나무 보기</button>
        <span className="tree-playback-time">{(progress * sampleTrajectory.duration).toFixed(1)} / {sampleTrajectory.duration.toFixed(2)}초</span>
      </div>
      <input aria-label="공 이동 위치" type="range" min="0" max="1" step="0.001" value={progress} disabled={!ready || busy} onChange={event => {
        const instance = scene.current;
        if (!instance) return;
        instance.seek(Number(event.target.value)); instance.setAutoCamera(true, false); setView('putting');
        setMessage('공 위치를 이동했습니다. 이어서 굴리기로 재생할 수 있습니다.');
      }}/>
      <p>6m 샘플 퍼팅 · 공 굴리기를 누르면 공을 따라갑니다.</p>
    </section>
    <div className="review-scene-scroll"><div className="review-scene" ref={host} style={{ width: sizes[size][0], height: sizes[size][1] }}/></div>
    <div className="review-status" role="status"><span className={`status-dot ${busy ? 'slow' : ''}`}/>{message}</div>
    <div className="review-actions"><button disabled={!ready || busy} onClick={() => void capturePairs(false)}>현재 시점 PNG 두 장</button><button disabled={!ready || busy} onClick={() => void capturePairs(true)}>전체 시점 비교 저장</button><button disabled={!ready || busy} onClick={() => void recordOrbit()}>360° 회전·영상 저장</button></div>
    <p className="tree-capture-note">버튼으로 생성한 자료에만 ‘실제 브라우저’라고 표시합니다. 이 페이지를 PC의 세로 해상도로 실행한 결과는 모바일 실기기 검증이 아닙니다.</p>
    {captures.length > 0 && <section className="review-gallery"><h2>이 브라우저에서 저장한 결과</h2><div>{captures.map((capture, index) => <figure key={index}>{capture.video ? <video src={capture.url} controls loop playsInline/> : <img src={capture.url} alt={capture.label}/>}<figcaption>{capture.label}<a href={capture.url} download={capture.file}>저장</a></figcaption></figure>)}</div></section>}
    <section className="review-reference"><p className="eyebrow">CPU REFERENCE / NOT BROWSER CAPTURES</p><h2>저장된 비교 결과</h2><p>에이전트의 Windows 브라우저 도구가 현재 URL을 확인하지 못해 브라우저 캡처는 확보하지 못했습니다. 아래는 실제 코스 씬의 CPU 참고 렌더입니다. 실기기 FPS는 미측정입니다.</p>
      <p>성목을 축소한 작은 나무 21그루와 해당 접지 음영을 제거했습니다. 아래는 제거 후 전체·밑동·세로 화면입니다.</p>
      <img src={`${cleanupRoot}/desktop/external/whole.png`} alt="CPU 참고: 작은 나무 제거 후 전체 모습" loading="lazy"/>
      <img src={`${cleanupRoot}/desktop/external/roots.png`} alt="CPU 참고: 작은 나무와 불필요한 접지 음영 제거 후 밑동" loading="lazy"/>
      <img src={`${cleanupRoot}/mobile/external/whole.png`} alt="CPU 참고: 작은 나무 제거 후 모바일 세로 비율" loading="lazy"/>
      <a href={`${referenceRoot}/index.html`}>이전 전체·탑뷰·360° 품질 비교 기록 · 작은 나무 제거 전 ↗</a>
    </section>
    <footer className="review-notes"><strong>외부 원본 한 그루의 품질을 검토하는 단계입니다.</strong><p>Tree Small 02 / Rico Cilliers / Poly Haven · CC0. 원본 가지·잎·UV·노멀을 보존하고 2K 원본 재질과 잎 투명도를 사용합니다. 비교를 위해 현재 나무와 높이를 맞췄습니다. 이 자산에는 노출 뿌리 메시가 없어 밑동을 지면에 3.5cm 묻습니다. 주변 성목 배치는 유지하고 성목을 축소한 작은 나무만 제거했습니다.</p><p><a href="https://polyhaven.com/a/tree_small_02" target="_blank" rel="noreferrer">원본 출처</a> · <a href="https://polyhaven.com/license" target="_blank" rel="noreferrer">공식 CC0 고지</a> · <a href={`${import.meta.env.BASE_URL}vegetation/external/tree-small-02/provenance.json`}>변환·체크섬 기록</a> · <a href="?review=vegetation">이전 A/B 비교</a></p></footer>
  </main>;
}
