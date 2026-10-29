import type { PlaybackPhase } from '../core/playback';
import { Icon } from './icons';
import './roll-ball-button.css';

export function RollBallButton({ playing, phase, disabled, onClick }: {
  playing: boolean;
  phase: PlaybackPhase;
  disabled: boolean;
  onClick: () => void;
}) {
  const label = playing ? '일시정지' : phase === 'result' ? '다시 굴리기' : phase === 'rolling' ? '이어서 굴리기' : '공 굴리기';
  return <button type="button" className="roll-ball-button" disabled={disabled} onClick={onClick} aria-label={label}>
    <Icon name={playing ? 'pause' : 'play'} size={18}/><span>{label}</span>
  </button>;
}
