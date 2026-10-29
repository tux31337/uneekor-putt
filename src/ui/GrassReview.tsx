import { useEffect, useRef, useState } from 'react';
import { PuttingScene } from '../scene/PuttingScene';
import type { GrassInspectionView, GrassMode } from '../scene/grassPrototype';
import { DEFAULT_GREEN, DEFAULT_VIEW, makeSampleTrajectory } from '../core/trajectory';
import './grass-review.css';

const views: Record<GrassInspectionView, string> = { ball: '공 주변', macro: '3mm 잎 근접', edge: '그린 가장자리', 'edge-macro': '프린지·러프 근접', course: '코스 전체' };
type Size = 'desktop' | 'mobile';
const sizes = { desktop: [960, 600], mobile: [390, 564] } as const;
const labels = { baseline: '기존 잔디', prototype: '새 잔디 시제품' } as const;

export default function GrassReview() {
  const [size, setSize] = useState<Size>(() => window.innerWidth < 650 ? 'mobile' : 'desktop');
  const [mode, setMode] = useState<GrassMode>('prototype');
  const [view, setView] = useState<GrassInspectionView>('macro');
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('코스와 잔디를 불러오고 있습니다.');
  const [captures, setCaptures] = useState<{ url: string; file: string; label: string }[]>([]);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<PuttingScene | null>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => {
    let active = true;
    setReady(false); setPlaying(false); setProgress(0);
    const [width, height] = sizes[size];
    host.current!.style.width = `${width}px`; host.current!.style.height = `${height}px`;
    const instance = new PuttingScene(host.current!, DEFAULT_GREEN, { ...DEFAULT_VIEW, grid: false, flow: false, trajectory: false, quality: 'high' }, makeSampleTrajectory(DEFAULT_GREEN), {
      onReady: () => { if (active) { instance.setGrassInspection(view); setReady(true); setMessage('기존·시제품 버튼으로 같은 구도의 잔디를 비교하세요.'); } },
      onProgress: value => { if (active) setProgress(value); },
      onPlayingChange: value => { if (active) setPlaying(value); },
      onComplete: () => { if (active) setMessage('샘플 퍼팅이 끝났습니다. 처음으로 버튼으로 다시 비교하세요.'); },
      onStats() {}, onError: error => { if (active && error) { setReady(false); setMessage(error); } },
    }, { grass: mode, fixedPixelRatio: 1 });
    scene.current = instance;
    return () => { active = false; instance.dispose(); scene.current = null; };
    // Recreate only for an explicit comparison resolution change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);
  useEffect(() => () => { urls.current.forEach(URL.revokeObjectURL); }, []);

  function changeMode(next: GrassMode) { scene.current?.setGrassMode(next); setMode(next); }
  function changeView(next: GrassInspectionView) {
    scene.current?.pause(); scene.current?.setGrassInspection(next); setView(next);
  }
  function reset() { scene.current?.seek(0); scene.current?.setGrassInspection(view); }
  async function capturePair() {
    const instance = scene.current;
    if (!instance) return;
    instance.pause(); setReady(false);
    try {
      const reference = instance.getReviewState();
      for (const variant of ['baseline', 'prototype'] as const) {
        instance.setGrassMode(variant);
        const state = instance.getReviewState();
        if (JSON.stringify([state.cameraMatrix, state.ball, state.elapsed]) !== JSON.stringify([reference.cameraMatrix, reference.ball, reference.elapsed])) throw new Error('카메라 또는 재생 위치가 변경됐습니다. 다시 저장해 주세요.');
        const url = URL.createObjectURL(await instance.captureFrame()); urls.current.push(url);
        setCaptures(current => [...current, { url, file: `${size}-${view}-${variant}-browser.png`, label: labels[variant] }]);
      }
      setMessage('현재 브라우저에서 만든 같은 구도의 PNG 두 장을 아래에서 저장할 수 있습니다.');
    } catch (error) { setMessage(String(error)); }
    finally { instance.setGrassMode(mode); setReady(true); }
  }

  return <main className="grass-review">
    <a href="./">← 퍼팅 연습으로</a>
    <header><p className="grass-eyebrow">TURF STUDY · 04</p><h1>짧게 깎인 잔디의 결</h1><p>근접 잔디의 밀도와 깊이에 더해 공 밑 잎의 눌림과 골프공 딤플을 보정했습니다. 그린 3mm · 프린지 11mm · 러프 30mm를 출발점으로 비교합니다.</p></header>
    <section className="grass-controls" aria-label="잔디 비교 설정">
      <div>{(['baseline', 'prototype'] as const).map(value => <button key={value} disabled={!ready} aria-pressed={mode === value} onClick={() => changeMode(value)}>{labels[value]}</button>)}</div>
      <div>{(Object.keys(views) as GrassInspectionView[]).map(value => <button key={value} disabled={!ready} aria-pressed={view === value} onClick={() => changeView(value)}>{views[value]}</button>)}</div>
      <div><button aria-pressed={size === 'desktop'} onClick={() => setSize('desktop')}>가로 960×600</button><button aria-pressed={size === 'mobile'} onClick={() => setSize('mobile')}>세로 390×564</button><button disabled={!ready} onClick={() => void capturePair()}>같은 구도 PNG 두 장</button></div>
    </section>
    <div className="grass-live-wrap"><div ref={host} className="grass-live" /></div>
    <div className="grass-playback"><button disabled={!ready} onClick={() => { if (playing) scene.current?.pause(); else { setView('ball'); scene.current?.rollBall(); } }}>{playing ? '일시정지' : '샘플 공 굴리기'}</button><button disabled={!ready} onClick={reset}>처음으로</button><input aria-label="재생 위치" type="range" min={0} max={1} step={0.001} value={progress} disabled={!ready} onChange={event => { scene.current?.seek(Number(event.target.value)); scene.current?.setGrassInspection(view); }}/></div>
    <p role="status">{message}</p>
    {captures.length > 0 && <div className="grass-captures">{captures.map(item => <a key={item.url} href={item.url} download={item.file}><img src={item.url} alt={item.label}/>{item.label} PNG ↓</a>)}</div>}
    <section className="grass-reference"><h2>공 접촉부·딤플 보정 비교</h2><p>아래는 같은 구도로 저장한 CPU 참고 렌더입니다. 왼쪽은 이전 보정본, 오른쪽은 공 밑 잎의 눌림과 딤플을 보정한 현재 시제품입니다. 카메라·조명·공의 위치와 크기·수목은 동일합니다. 세로 이미지는 화면 비율 비교용이고 실제 휴대폰 캡처가 아닙니다.</p>
      {(['ball', 'macro', 'edge', 'edge-macro'] as const).map(value => <figure key={value}><figcaption>{views[value]} · 보정 전 / 보정 후</figcaption><a href={`putting-details-20261028/${size}-${value}.jpg`}><img loading="lazy" src={`putting-details-20261028/${size}-${value}.jpg`} alt={`${views[value]}, 왼쪽 이전 보정본과 오른쪽 접촉부·딤플 보정 후 시제품 CPU 비교`}/></a></figure>)}
      <p>상단에서 잔디를 전환하고 현재 구도의 PNG 두 장을 저장할 수 있습니다. 모바일 실기기의 FPS는 측정하지 않았습니다. 퍼팅은 화면 확인용 샘플이며 실제 물리 계산이 아닙니다.</p>
      <a href="putting-details-20261028/index.html">접촉부·딤플·경사 흐름 전체 비교와 검증 결과 ↗</a>
      <p><a href="grass-depth-20261028/index.html">이전 밀도·깊이 보강 기록 ↗</a> · <a href="grass-refinement-20261028/index.html">이전 명암·접지 보정 기록 ↗</a> · <a href="grass-review/index.html">최초 기존/시제품 비교 자료 ↗</a></p>
    </section>
  </main>;
}
