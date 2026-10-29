import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_GREEN, DEFAULT_VIEW, makeSampleTrajectory, parseTrajectory,
  type GreenSettings, type Trajectory, type ViewSettings,
} from '../core/trajectory';
import { PuttingScene, type CameraView, type SceneStats } from '../scene/PuttingScene';
import { Icon, type IconName } from './icons';
import { reportRenderDiagnostic } from '../scene/diagnostics';
import { distanceToHole, shotResult, type PlaybackPhase } from '../core/playback';
import { ENVIRONMENT_LABELS, type EnvironmentMode } from '../scene/CourseEnvironment';
import { RollBallButton } from './RollBallButton';

declare global {
  interface Window { ReactNativeWebView?: { postMessage: (message: string) => void } }
}

function notifyHost(type: string, payload: unknown) {
  window.ReactNativeWebView?.postMessage(JSON.stringify({ type, payload }));
}

const presets = [
  { label: '평지', sub: 'STRAIGHT', crossSlope: 0, longitudinalSlope: 0, shape: 'flat' },
  { label: '좌측 브레이크', sub: 'LEFT BREAK', crossSlope: 1.5, longitudinalSlope: 0.5, shape: 'break' },
  { label: '오르막', sub: 'UPHILL', crossSlope: 0.5, longitudinalSlope: 3, shape: 'uphill' },
];

export default function App() {
  const [green, setGreen] = useState<GreenSettings>(DEFAULT_GREEN);
  const [view, setView] = useState<ViewSettings>(DEFAULT_VIEW);
  const [trajectory, setTrajectory] = useState<Trajectory>(() => makeSampleTrajectory(DEFAULT_GREEN));
  const [camera, setCamera] = useState<CameraView>('ball');
  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState<PlaybackPhase>('ready');
  const [autoCamera, setAutoCamera] = useState(true);
  const [progress, setProgress] = useState(0);
  const [rate, setRate] = useState(1);
  const [stats, setStats] = useState<SceneStats>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(() => window.matchMedia('(min-width: 851px)').matches);
  const [ready, setReady] = useState(false);
  const [environment, setEnvironment] = useState<EnvironmentMode>('specimen');
  const [environmentLoading, setEnvironmentLoading] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PuttingScene | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const guideRef = useRef<HTMLDialogElement>(null);
  const dataRef = useRef({ green, view, trajectory });
  dataRef.current = { green, view, trajectory };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setReady(false);
    setError('');
    try {
      const initial = dataRef.current;
      const scene = new PuttingScene(host, initial.green, initial.view, initial.trajectory, {
        onReady: () => { setReady(true); notifyHost('putting:ready', { version: 1 }); },
        onProgress: setProgress,
        onComplete: () => { notifyHost('putting:complete', { id: dataRef.current.trajectory.id, ...shotResult(dataRef.current.trajectory, dataRef.current.green) }); },
        onPhaseChange: setPhase,
        onPlayingChange: setPlaying,
        onAutoCameraChange: setAutoCamera,
        onStats: setStats,
        onError: message => { setError(message); if (message) setReady(false); },
      });
      sceneRef.current = scene;
      return () => { scene.dispose(); sceneRef.current = null; };
    } catch (e) {
      reportRenderDiagnostic('scene-error', { message: String(e), stack: e instanceof Error ? e.stack : undefined });
      setError('3D 화면을 시작할 수 없습니다. WebGL 2를 지원하는 브라우저에서 다시 열어 주세요.');
      console.error(e);
    }
  }, []);

  useEffect(() => { sceneRef.current?.setGreen(green); }, [green]);
  useEffect(() => { sceneRef.current?.setView(view); }, [view]);
  useEffect(() => { sceneRef.current?.setTrajectory(trajectory); }, [trajectory]);
  useEffect(() => { sceneRef.current?.setRate(rate); }, [rate]);

  const applyExternal = useCallback((value: unknown) => {
    const parsed = parseTrajectory(value);
    setTrajectory(parsed);
    const endpoint = parsed.points.at(-1)!;
    if (parsed.outcome === 'holed' && endpoint.z >= 2 && endpoint.z <= 12 && Math.abs(endpoint.x) < 0.2) {
      setGreen(current => ({ ...current, distance: endpoint.z }));
    }
    setNotice('내 궤적을 불러왔습니다.');
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      try {
        const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (message?.type === 'putting:set-trajectory') applyExternal(message.payload);
        if (message?.type === 'putting:pause') sceneRef.current?.pause();
      } catch (e) { setNotice(e instanceof Error ? e.message : '궤적 데이터를 확인해 주세요.'); }
    };
    window.addEventListener('message', onMessage);
    // Android WebView versions can deliver host messages on document.
    document.addEventListener('message', onMessage as EventListener);
    return () => { window.removeEventListener('message', onMessage); document.removeEventListener('message', onMessage as EventListener); };
  }, [applyExternal]);

  useEffect(() => { if (notice) { const timer = window.setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer); } }, [notice]);
  useEffect(() => { if (guideOpen) guideRef.current?.showModal(); else guideRef.current?.close(); }, [guideOpen]);

  function updateGreen(patch: Partial<GreenSettings>) {
    resetPlayback();
    const next = { ...green, ...patch };
    setGreen(next);
    if (trajectory.source === 'sample') setTrajectory(makeSampleTrajectory(next));
    notifyHost('putting:settings', next);
    window.dispatchEvent(new CustomEvent('putting:request-trajectory', { detail: next }));
  }

  function togglePlay() {
    if (playing) sceneRef.current?.pause(); else sceneRef.current?.rollBall();
  }

  function changeCamera(next: CameraView) { setCamera(next); sceneRef.current?.setCamera(next); }
  async function changeEnvironment(mode: EnvironmentMode) {
    setEnvironmentLoading(true);
    try { await sceneRef.current?.setEnvironment(mode); setEnvironment(mode); }
    catch (error) { setNotice(error instanceof Error ? error.message : '배경을 불러오지 못했습니다.'); }
    finally { setEnvironmentLoading(false); }
  }
  function resetPlayback() { sceneRef.current?.seek(0); }
  function startPlayback() { sceneRef.current?.rollBall(); }
  const slopeLabel = [
    green.crossSlope === 0 ? '' : green.crossSlope > 0 ? '왼쪽으로 흐름' : '오른쪽으로 흐름',
    green.longitudinalSlope === 0 ? '' : green.longitudinalSlope > 0 ? '오르막' : '내리막',
  ].filter(Boolean).join(' · ') || '평지';
  const hasSlope = green.crossSlope !== 0 || green.longitudinalSlope !== 0;
  const remaining = distanceToHole(trajectory, green, progress * trajectory.duration);
  const result = shotResult(trajectory, green);
  const phaseLabel = phase === 'ready' ? '준비' : phase === 'result' ? '결과' : playing ? '공 이동 중' : '일시정지';

  return <div className="app-shell">
    <header className="site-header">
      <a className="brand" href="#" aria-label="Putting Lab 홈"><span className="brand-mark"><Icon name="flag" size={23}/></span><span>putting<span className="brand-light">lab</span><span className="brand-period">.</span></span></a>
      <div className="header-centre"><span className="status-dot"/> YOUR EVERYDAY PRACTICE GREEN</div>
      <button className="guide-button" onClick={() => setGuideOpen(true)}><Icon name="info" size={17}/><span>사용 가이드</span><Icon name="chevron" size={13}/></button>
    </header>

    <main>
      <section className="page-intro">
        <div><div className="eyebrow"><span/> READ THE GREEN. FIND YOUR LINE.</div><h1>그린을 읽는 시간<span>.</span></h1><p>경사를 살피고, 라인을 그려보세요. 나만의 퍼팅 연습이 시작됩니다.</p></div>
        <button className="import-button" aria-label="내 궤적 불러오기" onClick={() => fileRef.current?.click()}><Icon name="upload" size={17}/> 내 궤적 불러오기</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async event => {
          const file = event.target.files?.[0];
          if (!file) return;
          try {
            if (file.size > 2 * 1024 * 1024) throw new Error('2MB 이하의 궤적 파일을 선택해 주세요.');
            applyExternal(JSON.parse(await file.text()));
          } catch (e) { setNotice(e instanceof Error ? e.message : '파일을 불러올 수 없습니다.'); }
          event.target.value = '';
        }}/>
      </section>

      <div className="practice-layout">
        <section className="practice-panel" aria-label="3D 퍼팅 연습장">
          <div className="green-summary">
            <div className="green-title"><span className="green-number">01</span><div><strong>Practice green</strong><span>매일 조금씩, 더 정확하게.</span></div></div>
            <div className="summary-values"><div><small>거리</small><strong>{green.distance.toFixed(1)}<span>m</span></strong></div><i/><div><small>그린 스피드</small><strong>{green.stimp.toFixed(1)}<span>ft</span></strong></div></div>
          </div>

          <div className="environment-toolbar"><div className="environment-options" aria-label="코스 배경 시제품">
            {(Object.keys(ENVIRONMENT_LABELS) as EnvironmentMode[]).map(mode => <button key={mode} aria-pressed={environment === mode} disabled={!ready || environmentLoading} onClick={() => void changeEnvironment(mode)}>{ENVIRONMENT_LABELS[mode]}</button>)}
          </div><a href="?review=grass">잔디 시제품 비교 ↗</a><a href="?review=tree">한 그루 품질 비교 ↗</a></div>
          <div className="playback-steps" aria-label="퍼팅 진행" role="list">
            {([{ id: 'ready', label: '그린 읽기' }, { id: 'rolling', label: '공 따라가기' }, { id: 'result', label: '결과 확인' }] as const).map((step, index) =>
              <span key={step.id} role="listitem" className={phase === step.id ? 'current' : ''} aria-current={phase === step.id ? 'step' : undefined}><small>0{index + 1}</small>{step.label}</span>)}
          </div>
          <div className="viewport-wrap" data-phase={phase}>
            <div className="scene-host" ref={hostRef}/>
            <div className="scene-topline"><div className="scene-status"><span className="live-label"><span/>{phaseLabel}</span><span className="trajectory-source">{trajectory.source === 'sample' ? '샘플 궤적' : '내 궤적'}</span></div><div className="camera-switch" aria-label="카메라 시점">
              <button className={`auto-camera-button ${autoCamera ? 'selected' : ''}`} aria-pressed={autoCamera} aria-label="자동 카메라" title="공과 홀을 따라가는 자동 시점" onClick={() => sceneRef.current?.setAutoCamera(!autoCamera)}><Icon name="play" size={14}/><span>자동</span></button>
              {([{ id: 'ball', icon: 'eye', label: '공 뒤' }, { id: 'perspective', icon: 'orbit', label: '전체' }, { id: 'top', icon: 'top', label: '탑뷰' }, { id: 'surface', icon: 'layers', label: '잔디' }] as const).map(item => <button key={item.id} className={!autoCamera && camera === item.id ? 'selected' : ''} aria-pressed={!autoCamera && camera === item.id} aria-label={`${item.label} 보기`} onClick={() => changeCamera(item.id)} title={`${item.label} 보기`}><Icon name={item.icon} size={17}/><span>{item.label}</span></button>)}
            </div></div>

            {!ready && !error && <div className="scene-loading"><span className="loading-ball"/><span>연습 그린을 준비하고 있습니다</span></div>}
            {error && <div className="scene-error" role="alert"><Icon name="info" size={28}/><p>{error}</p><button onClick={() => location.reload()}>다시 열기</button></div>}

            <div className="scene-bottomline" aria-hidden={phase !== 'ready'}><div className="slope-indicator"><svg viewBox="0 0 60 60" width="48" height="48" aria-hidden="true"><circle cx="30" cy="30" r="27" fill="none" stroke="currentColor" strokeOpacity=".35"/><path d="M30 11v38M11 30h38" stroke="currentColor" strokeOpacity=".3"/>{hasSlope && <g transform={`rotate(${Math.atan2(-green.crossSlope, -green.longitudinalSlope) * -180 / Math.PI + 180} 30 30)`}><path d="m30 15 5 12h-10z" fill="currentColor"/><path d="M30 25v18" stroke="currentColor" strokeWidth="1.5"/></g>}</svg><div><strong>{Math.hypot(green.crossSlope, green.longitudinalSlope).toFixed(1)}<small>%</small></strong><span>{slopeLabel}</span></div></div>
              <div className="scene-legend">{view.trajectory && <span><i className="line-key"/>입력 궤적</span>}{view.grid && <span><i className="grid-key"/>격자 50cm</span>}</div>
            </div>
            {view.heatmap && <div className="heatmap-legend"><span>낮음</span><i/><span>높음</span></div>}
            {ready && !error && phase === 'rolling' && <div className="rolling-readout" aria-hidden="true"><span>홀까지</span><strong>{formatDistance(remaining)}</strong></div>}
            {ready && !error && phase === 'result' && <div className={`shot-result ${result.outcome}`} role="status" aria-live="polite">
              <span className="result-icon"><Icon name={result.outcome === 'holed' ? 'check' : 'flag'} size={24}/></span>
              <div className="result-copy"><span>{trajectory.source === 'sample' ? '샘플 재생 결과' : '퍼팅 결과'}</span><h2>{result.outcome === 'holed' ? '홀인!' : `홀까지 ${formatDistance(result.remaining)}`}</h2><p>{green.distance.toFixed(1)} m 퍼팅 · {result.duration.toFixed(1)}초</p></div>
              <div className="result-actions"><button onClick={startPlayback}><Icon name="reset" size={13}/>다시 보기</button><button onClick={resetPlayback}>준비로</button></div>
            </div>}
          </div>

          <div className="playback-panel">
            <div className="playback-main"><RollBallButton playing={playing} phase={phase} onClick={togglePlay} disabled={!ready || !!error || environmentLoading}/><div className="playback-title"><strong>{phase === 'result' ? '결과를 확인하고, 한 번 더 살펴보세요' : playing ? '공의 흐름을 따라가 보세요' : phase === 'rolling' ? '멈춘 위치에서 라인을 살펴보세요' : '그린을 읽고, 라인을 따라가 보세요'}</strong><span>{trajectory.source === 'sample' ? '화면 확인용 샘플 · 실제 궤적 데이터 연결 가능' : `${trajectory.points.length}개 좌표 · 입력 시간에 맞춰 재생`}</span></div><button className="reset-button" onClick={resetPlayback} disabled={!ready || !!error || environmentLoading} aria-label="재생 처음으로"><Icon name="reset" size={18}/></button><div className="rate-control"><select aria-label="재생 속도" value={rate} onChange={e => setRate(Number(e.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={1.5}>1.5×</option></select></div></div>
            <div className="timeline"><input aria-label="궤적 재생 위치" type="range" min={0} max={1} step={0.001} value={progress} disabled={!ready || !!error} style={{ '--progress': `${progress * 100}%` } as React.CSSProperties} onChange={e => sceneRef.current?.seek(Number(e.target.value))}/><span>{(progress * trajectory.duration).toFixed(1)} <small>/ {trajectory.duration.toFixed(1)}s</small></span></div>
          </div>
          <div className="viewport-footer"><span><Icon name="orbit" size={14}/> {autoCamera ? '자동 시점 · 드래그하면 직접 조절' : '직접 조절 · 핀치 또는 휠로 확대'}</span><button onClick={() => sceneRef.current?.setAutoCamera(true)}><Icon name="reset" size={13}/> 자동 시점으로</button></div>
        </section>

        <details className="settings-panel" open={settingsOpen} onToggle={event => setSettingsOpen(event.currentTarget.open)}>
          <summary className="settings-heading"><span><span className="eyebrow">MAKE IT YOUR GREEN</span><span className="settings-title"><Icon name="sliders" size={18}/>그린 설정</span></span><span className="settings-toggle"><span>{settingsOpen ? '접기' : '거리 · 경사 · 표시'}</span><Icon name="chevron" size={17}/></span></summary>
          <div className="settings-content">
          <div className="preset-row">{presets.map(preset => <button key={preset.shape} className={`preset-button ${preset.shape} ${green.crossSlope === preset.crossSlope && green.longitudinalSlope === preset.longitudinalSlope ? 'active' : ''}`} onClick={() => updateGreen({ crossSlope: preset.crossSlope, longitudinalSlope: preset.longitudinalSlope })}><span className="preset-art"><svg width="60" height="27" viewBox="0 0 60 27" aria-hidden="true"><path d={preset.shape === 'flat' ? 'M3 21h54' : preset.shape === 'break' ? 'M3 21C20 25 30 9 57 6' : 'M3 23 57 5'} fill="none" stroke="currentColor" strokeWidth="1.5"/><circle cx="11" cy={preset.shape === 'uphill' ? 18 : 17} r="2.7" fill="currentColor"/></svg></span><strong>{preset.label}</strong><small>{preset.sub}</small></button>)}</div>

          <div className="control-section">
            <Slider label="퍼팅 거리" value={green.distance} unit="m" min={2} max={12} step={0.5} start="가까이" end="멀리" onChange={value => updateGreen({ distance: value })}/>
            <Slider label="그린 스피드" help="같은 조건에서 공이 굴러가는 거리입니다. 숫자가 높을수록 빠른 그린입니다." value={green.stimp} unit="ft" min={6} max={14} step={0.5} start="느리게" end="빠르게" onChange={value => updateGreen({ stimp: value })}/>
          </div>
          <div className="control-section slope-section"><div className="section-label">경사 조절 <span>SLOPE</span></div>
            <Slider label="좌우 경사" value={green.crossSlope} unit="%" min={-5} max={5} step={0.1} start="오른쪽으로 흐름" end="왼쪽으로 흐름" signed onChange={value => updateGreen({ crossSlope: value })}/>
            <Slider label="앞뒤 경사" value={green.longitudinalSlope} unit="%" min={-5} max={5} step={0.1} start="내리막" end="오르막" signed onChange={value => updateGreen({ longitudinalSlope: value })}/>
          </div>
          <div className="display-section"><div className="section-label">그린 읽기 <span>OVERLAYS</span></div><div className="display-grid">
            {([{ key: 'grid', icon: 'grid', label: '격자' }, { key: 'flow', icon: 'flow', label: '경사 방향' }, { key: 'trajectory', icon: 'line', label: '궤적' }, { key: 'heatmap', icon: 'layers', label: '높낮이' }] as const).map(item => <button key={item.key} className={view[item.key] ? 'enabled' : ''} aria-pressed={view[item.key]} onClick={() => setView({ ...view, [item.key]: !view[item.key] })}><Icon name={item.icon} size={17}/><span>{item.label}</span><span className="mini-check">{view[item.key] && <Icon name="check" size={11}/>}</span></button>)}
          </div></div>
          <p className="display-hint">경사 표시는 준비 화면에서 보여줍니다.</p>
          <button className="practice-button" onClick={() => { resetPlayback(); startPlayback(); }} disabled={!ready || !!error || environmentLoading}>처음부터 공 굴리기 <Icon name="arrow" size={19}/></button>
          <p className="settings-note">천천히 관찰할수록, 라인이 선명해집니다.</p>
          {trajectory.source === 'external' && <button className="sample-reset" onClick={() => setTrajectory(makeSampleTrajectory(green))}>샘플 궤적으로 돌아가기</button>}
          </div>
        </details>
      </div>

      <footer className="page-footer"><span>ONE GREEN. ENDLESS POSSIBILITIES.</span><div className="quality-control"><span className={`status-dot ${stats && !stats.idle && stats.fps > 0 && stats.fps < 40 ? 'slow' : ''}`}/><span>{stats?.idle ? '선명한 정지 화면' : stats?.fps ? `${stats.fps} FPS` : '3D'}</span><span className="footer-divider"/><select aria-label="그래픽 품질" title="자동 품질은 정지하면 선명도를 높이고 재생 중에는 기기 성능에 맞춥니다." value={view.quality} onChange={e => setView({ ...view, quality: e.target.value as ViewSettings['quality'] })}><option value="auto">자동 품질</option><option value="high">고화질</option><option value="balanced">성능 우선</option></select><span className="perf-detail" title="현재 브라우저의 프레임 간격과 그리기 호출 수입니다. 휴대폰 성능 측정 결과와는 다릅니다.">{stats ? `${stats.idle ? '' : `p95 ${stats.frameMs}ms · `}${stats.drawCalls} draws` : ''}</span></div></footer>
    </main>

    {notice && <div className="toast" role="status"><Icon name="info" size={17}/>{notice}<button aria-label="알림 닫기" onClick={() => setNotice('')}><Icon name="close" size={15}/></button></div>}

    <dialog className="guide-dialog" ref={guideRef} onClose={() => setGuideOpen(false)} onClick={e => { if (e.target === e.currentTarget) setGuideOpen(false); }}><div className="guide-content"><button className="dialog-close" aria-label="가이드 닫기" onClick={() => setGuideOpen(false)}><Icon name="close"/></button><span className="eyebrow">A MOMENT ON THE GREEN</span><h2>라인이 보이기 시작하는 순간.</h2><p>그린을 돌려보고, 공 뒤에서 낮게 바라보고, 위에서 흐름을 살펴보세요.</p><ol><li><strong>내 그린 만들기</strong><span>거리와 경사를 바꾸고 높낮이·방향 표시를 켜보세요.</span></li><li><strong>시점 바꿔보기</strong><span>드래그는 회전, 두 손가락은 확대·이동입니다.</span></li><li><strong>라인 따라가기</strong><span>재생하거나 진행 막대를 움직여 공의 위치를 확인하세요.</span></li></ol><p className="guide-disclosure">현재 샘플은 화면 확인을 위한 예시입니다. 스팀프와 경사에 따른 실제 계산 결과는 보유한 궤적 데이터를 연결해 사용합니다.</p><button className="practice-button" onClick={() => setGuideOpen(false)}>그린으로 돌아가기 <Icon name="arrow" size={18}/></button></div></dialog>
  </div>;
}

function formatDistance(distance: number) {
  if (distance > 0 && distance < 0.01) return '1 cm 미만';
  return distance < 1 ? `${Math.round(distance * 100)} cm` : `${distance.toFixed(2)} m`;
}

function Slider({ label, help, value, unit, min, max, step, start, end, signed, onChange }: {
  label: string; help?: string; value: number; unit: string; min: number; max: number; step: number;
  start: string; end: string; signed?: boolean; onChange: (value: number) => void;
}) {
  const id = label.replaceAll(' ', '-');
  return <div className="slider-control"><div className="slider-label"><label htmlFor={id}>{label}</label>{help && <span className="help-tip" tabIndex={0} aria-label={help}><Icon name="info" size={14}/><span role="tooltip">{help}</span></span>}<output htmlFor={id}>{signed && value > 0 ? '+' : ''}{value.toFixed(1)}<small>{unit}</small></output></div><input id={id} type="range" min={min} max={max} step={step} value={value} style={{ '--progress': `${(value - min) / (max - min) * 100}%` } as React.CSSProperties} onChange={e => onChange(Number(e.target.value))}/><div className="slider-extents"><span>{start}</span><span>{end}</span></div></div>;
}
