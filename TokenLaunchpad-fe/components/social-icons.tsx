/** Small pictures for a token's social links. Decoration only: the accessible name (Website, Twitter, Telegram) is what a screen
 * reader says, drawn here so nothing has to be fetched to show which platform a link goes to. */

export function WebsiteIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a13.5 13.5 0 0 1 0 18" />
      <path d="M12 3a13.5 13.5 0 0 0 0 18" />
    </svg>
  );
}

/** The X (formerly Twitter) mark. */
export function TwitterIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M18.9 2.6h3.1l-6.9 7.9 8.1 10.9h-6.3l-5-6.5-5.6 6.5H3.1l7.4-8.4L2.7 2.6H9.2l4.5 5.9zm-1.1 16.9h1.7L7.3 4.4H5.5z" />
    </svg>
  );
}

/** Telegram's paper plane. */
export function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M21.9 4.3 18.6 20.2c-.2 1-.9 1.3-1.7.8l-4.8-3.6-2.3 2.2c-.3.3-.5.5-1 .5l.4-5 9-8.2c.4-.4-.1-.6-.6-.2L6.9 12.7l-4.7-1.5c-1-.3-1-1 .2-1.5L20.6 3.5c.8-.3 1.6.2 1.3 1.5" />
    </svg>
  );
}
