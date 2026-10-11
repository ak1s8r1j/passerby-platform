import type { ReactNode } from "react";

/** A small set of line icons, all drawn the same way (24 px grid, rounded 1.75 px strokes). */
const PATHS = {
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  reports: (
    <>
      <path d="M5.5 21V4" />
      <path d="M5.5 4.5h12l-2.5 4 2.5 4h-12" />
    </>
  ),
  bans: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 6l12 12" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5" />
      <path d="M16 4.7a3.5 3.5 0 010 6.6" />
      <path d="M18 14.8c1.9.7 3.2 2.4 3.5 5.2" />
    </>
  ),
  activity: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r=".9" />
      <circle cx="4.5" cy="12" r=".9" />
      <circle cx="4.5" cy="18" r=".9" />
    </>
  ),
  system: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  chevron: <path d="M9.5 5l7 7-7 7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 8.5V6.5a2 2 0 00-2-2H6a2 2 0 00-2 2V14a2 2 0 002 2h2.5" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="M7.5 11l4.5 4.5 4.5-4.5" />
      <path d="M5 20h14" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  signout: (
    <>
      <path d="M10 4H6.5A2.5 2.5 0 004 6.5v11A2.5 2.5 0 006.5 20H10" />
      <path d="M15 8l4 4-4 4M19 12H9" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 11-2.6-5.9" />
      <path d="M20 4v5h-5" />
    </>
  ),
  shield: <path d="M12 3l7.5 3v5.5c0 4.6-3 8-7.5 9.5-4.5-1.5-7.5-4.9-7.5-9.5V6L12 3z" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
