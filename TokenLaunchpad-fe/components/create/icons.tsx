/** Small pictures for the create form, drawn here so no image has to be fetched. All are decoration: the words beside them say it. */

export function ImageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <rect x="6" y="6" width="36" height="36" rx="5" />
      <circle cx="31" cy="17" r="3.5" />
      <path d="M8 36l10-10 7 7 4-4 11 9" />
    </svg>
  );
}

/** The Ethereum diamond, on a dark disc. */
export function EthIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <circle cx="16" cy="16" r="16" fill="#16181d" />
      <g fill="#ffffff">
        <path d="M16 4l-.2.7v14.2l.2.2 6.5-3.8z" opacity=".6" />
        <path d="M16 4L9.5 15.3l6.5 3.8z" />
        <path d="M16 20.4l-.1.1v6.2l.1.3 6.5-9.1z" opacity=".6" />
        <path d="M16 27v-6.6l-6.5-2.5z" />
        <path d="M16 19.1l6.5-3.8-6.5-3z" opacity=".25" />
        <path d="M9.5 15.3l6.5 3.8v-6.8z" opacity=".6" />
      </g>
    </svg>
  );
}

/** USDC: a dollar sign in a ring, on a blue disc. */
export function UsdcIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <circle cx="16" cy="16" r="16" fill="#2775ca" />
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="#ffffff" strokeWidth="2" />
      <text x="16" y="21.5" textAnchor="middle" fontSize="15" fontWeight="700" fontFamily="sans-serif" fill="#ffffff">
        $
      </text>
    </svg>
  );
}

/** Base: its own mark, a white bar on a blue disc. */
export function BaseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <circle cx="16" cy="16" r="16" fill="#0052ff" />
      <rect x="9" y="14.5" width="14" height="3" rx="1.5" fill="#ffffff" />
    </svg>
  );
}

/** Solana: three angled bars in its gradient, on a dark disc. */
export function SolanaIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <circle cx="16" cy="16" r="16" fill="#16181d" />
      <defs>
        <linearGradient id="solana-gradient" x1="6" y1="10" x2="26" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#00ffa3" />
          <stop offset="1" stopColor="#dc1fff" />
        </linearGradient>
      </defs>
      <g fill="url(#solana-gradient)">
        <path d="M9.5 20.3a1 1 0 01.7-.3h13.3a.5.5 0 01.35.85l-2.7 2.7a1 1 0 01-.7.3H6.15a.5.5 0 01-.35-.85z" />
        <path d="M9.5 8.45a1 1 0 01.7-.3h13.3a.5.5 0 01.35.85l-2.7 2.7a1 1 0 01-.7.3H6.15a.5.5 0 01-.35-.85z" />
        <path d="M22.5 14.35a1 1 0 00-.7-.3H8.5a.5.5 0 00-.35.85l2.7 2.7a1 1 0 00.7.3h13.3a.5.5 0 00.35-.85z" />
      </g>
    </svg>
  );
}

/** Robinhood: its feather mark, on a lime disc. */
export function RobinhoodIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <circle cx="16" cy="16" r="16" fill="#ccf23f" />
      <path d="M20 8c-3.5 2-9 6-9 13.5 1.5-2 3.7-3.2 6-3.7-1-1.4-1.3-3-.9-4.6 1.6 1.8 3.6 2.4 5.4 1.8-2.3-1.4-2.6-4.3-1.5-7z" fill="#000000" />
    </svg>
  );
}

/** An open eye, marking a live preview of what is being typed. */
export function EyeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
