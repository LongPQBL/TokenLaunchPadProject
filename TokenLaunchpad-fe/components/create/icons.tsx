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

/** An open eye, marking a live preview of what is being typed. */
export function EyeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
