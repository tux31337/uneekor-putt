import type { CSSProperties } from 'react';

export type IconName = 'flag' | 'chevron' | 'play' | 'pause' | 'reset' | 'grid' | 'flow' | 'line' | 'layers' | 'top' | 'orbit' | 'eye' | 'upload' | 'close' | 'arrow' | 'check' | 'info' | 'sliders';
const paths: Record<IconName, React.ReactNode> = {
  flag: <><path d="M6 21V3l13 4-13 5"/><path d="M3 20c0 1 3 2 6 2s6-1 6-2"/></>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  play: <path d="m9 5 11 7-11 7V5Z"/>,
  pause: <><path d="M8 5v14M16 5v14"/></>,
  reset: <><path d="M3 10a9 9 0 1 1 1 7M3 4v6h6"/></>,
  grid: <><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></>,
  flow: <><path d="M4 7h15m-4-4 4 4-4 4M4 17h15m-4-4 4 4-4 4"/></>,
  line: <><path d="M4 20C3 4 21 20 20 4"/><circle cx="4" cy="20" r="2"/><circle cx="20" cy="4" r="2"/></>,
  layers: <><path d="m12 3 10 6-10 6L2 9l10-6ZM2 14l10 6 10-6"/></>,
  top: <><rect x="5" y="3" width="14" height="18" rx="6"/><circle cx="12" cy="8" r="1"/><path d="M12 13v4"/></>,
  orbit: <><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-30 12 12)"/><circle cx="12" cy="12" r="3"/></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/></>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/></>,
  sliders: <><path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></>,
};
export function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}
