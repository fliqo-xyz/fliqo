/* Line icons drawn for this site: 24px grid, 1.8px stroke, round caps. */

type P = { size?: number; className?: string };

function Svg({ size = 16, className, children }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {children}
    </svg>
  );
}

export const ArrowUpRight = (p: P) => (
  <Svg {...p}>
    <path d="M7 17 17 7M8 7h9v9" />
  </Svg>
);
export const ArrowRight = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);
export const ArrowLeft = (p: P) => (
  <Svg {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);
export const ArrowDown = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
);
export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="m5 12 5 5 9-10" />
  </Svg>
);
export const CloseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const CopyIcon = (p: P) => (
  <Svg {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </Svg>
);
export const FileIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Svg>
);
export const LogOutIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </Svg>
);
export const RefreshIcon = (p: P) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" />
  </Svg>
);
export const WalletIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h14v4M3 7v10a2 2 0 0 0 2 2h16V9H5a2 2 0 0 1-2-2Z" />
    <circle cx="16.5" cy="14" r="1" />
  </Svg>
);
export const MenuIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);
export const SearchIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
);
export const BellIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </Svg>
);
export const GridIcon = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
  </Svg>
);
export const ListIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 7h14M5 12h14M5 17h14" />
  </Svg>
);
export const SidebarIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4" width="17" height="16" rx="1.5" />
    <path d="M9 4v16M15 10l-2 2 2 2" />
  </Svg>
);
export const InfoIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);
export const PlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const SwapIcon = (p: P) => (
  <Svg {...p}>
    <path d="M7 4v14M3 14l4 4 4-4M17 20V6M13 10l4-4 4 4" />
  </Svg>
);
export const XLogo = ({ size = 14 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3Zm-1.08 16.17h1.7L7.4 4.74H5.58l11.09 14.43Z" />
  </svg>
);

export const HomeIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />
  </Svg>
);
export const BarsIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 20v-6M10 20V8M15 20v-9M20 20V5" />
  </Svg>
);
export const CandleIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 3v3M8 16v5M16 3v6M16 17v4" />
    <rect x="5.5" y="6" width="5" height="10" rx="1.4" />
    <rect x="13.5" y="9" width="5" height="8" rx="1.4" />
  </Svg>
);
export const TrendIcon = (p: P) => (
  <Svg {...p}>
    <path d="m3 17 6-6 4 4 8-8M15 7h6v6" />
  </Svg>
);
export const SproutIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 21v-9M12 12c0-4-3-6-8-6 0 4 3 6 8 6zM12 12c0-3 2-5 7-5 0 3-2 5-7 5" />
  </Svg>
);
export const LayersIcon = (p: P) => (
  <Svg {...p}>
    <path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5" />
  </Svg>
);
export const StarIcon = ({ filled, ...p }: P & { filled?: boolean }) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden="true" className={p.className}>
    <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" />
  </svg>
);
export const PieIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3a9 9 0 1 0 9 9h-9z" />
    <path d="M15 3.5A9 9 0 0 1 20.5 9H15z" />
  </Svg>
);
export const ClipboardIcon = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="5" width="14" height="16" rx="2" />
    <path d="M9 5V3.5h6V5M9 11h6M9 15h4" />
  </Svg>
);
export const PulseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 12h4l2-6 4 12 2-6h6" />
  </Svg>
);
export const BookIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
    <path d="M5 17a3 3 0 0 1 3-3h10" />
  </Svg>
);
export const ShieldIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 5 6v5c0 5 3 8.5 7 10 4-1.5 7-5 7-10V6z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);
export const PhoneIcon = (p: P) => (
  <Svg {...p}>
    <rect x="7" y="3" width="10" height="18" rx="2.2" />
    <path d="M11 18h2" />
  </Svg>
);
export const FlagIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
  </Svg>
);
export const DotsIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth={3} />
  </Svg>
);
export const MoonIcon = (p: P) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
  </Svg>
);
export const SunIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);
export const TokenIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7v10M9 9.5h4.5a1.8 1.8 0 0 1 0 3.6H9h5a1.8 1.8 0 0 1 0 3.6H9" />
  </Svg>
);
export const PauseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 6v12M15 6v12" />
  </Svg>
);
export const PlayIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 5v14l11-7z" />
  </Svg>
);
export const GithubIcon = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7 3.6 3.6 0 0 1 .1-2.7s.8-.3 2.8 1a9.6 9.6 0 0 1 5 0c2-1.3 2.8-1 2.8-1 .4 1 .4 1.9.1 2.7a3.9 3.9 0 0 1 1 2.7c0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z" />
  </svg>
);
