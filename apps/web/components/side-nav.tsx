"use client";

import { UI } from "@vezta/shared";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAccount } from "wagmi";
import { useSiwe } from "@/lib/auth/use-siwe";
import { cn } from "@/lib/utils";
import { requestLogin } from "@/lib/wallet/login-trigger";

type Page = "discover" | "watchlist" | "create" | "profile" | "admin";

/**
 * Which listed page a path belongs to. A token's page is part of Discover (it is where Discover leads); a path that matches
 * nothing listed marks nothing, and another chain's pages are not this chain's.
 */
export function pageOf(pathname: string | null, chain: string): Page | undefined {
  const path = (pathname ?? "").replace(/\/+$/, "");
  const home = `/${chain}`;
  if (path === home || path.startsWith(`${home}/token/`)) return "discover";
  if (path === `${home}/watchlist`) return "watchlist";
  if (path === `${home}/create`) return "create";
  if (path.startsWith(`${home}/profile/`)) return "profile";
  if (path === `${home}/admin` || path.startsWith(`${home}/admin/`)) return "admin";
  return undefined;
}

const icon = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
    {children}
  </svg>
);
const ICONS: Record<Page, ReactNode> = {
  discover: icon(
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
    </>,
  ),
  watchlist: icon(<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z" />),
  create: icon(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </>,
  ),
  profile: icon(
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.2-3.6 4-5.5 8-5.5s6.8 1.9 8 5.5" />
    </>,
  ),
  admin: icon(<path d="M12 3l7.5 3v5.5c0 4.6-3.1 8.2-7.5 9.5-4.4-1.3-7.5-4.9-7.5-9.5V6z" />),
};

/**
 * The way between the app's pages. On a wide screen it is a rail down the left edge, icons only, that opens over the page to
 * show each page's name while the pointer is on it (or something in it has focus, so the keyboard gets the same); it never
 * pushes the page around. On a narrow screen it is a bar along the bottom. The names are always in the page, only drawn
 * when there is room, so a screen reader hears the same thing whether the rail is open or not.
 *
 * Profile is always listed, but needs a wallet to have a profile of its own: without one it is a button that opens the same
 * login the header's does. Admin is drawn only for a signed-in admin (the API says who that is): nobody else is shown that the
 * admin page exists. This only decides what to draw; the API decides who may act.
 */
export function SideNav({ chain }: { chain: string }) {
  const pathname = usePathname();
  const { address } = useAccount();
  const { isAdmin } = useSiwe();
  const open = pageOf(pathname, chain);

  const items: { page: Page; label: string; href?: string }[] = [
    { page: "discover", label: UI.nav.discover, href: `/${chain}` },
    // For everyone: with no one logged in the page itself says to, which is kinder than a link that is not there.
    { page: "watchlist", label: UI.nav.watchlist, href: `/${chain}/watchlist` },
    { page: "create", label: UI.nav.create, href: `/${chain}/create` },
    // Always listed: without a wallet there is no profile to open, so it asks to connect one instead (see below).
    { page: "profile", label: UI.nav.profile, href: address ? `/${chain}/profile/${address}` : undefined },
    ...(isAdmin ? [{ page: "admin" as const, label: UI.nav.admin, href: `/${chain}/admin` }] : []),
  ];

  return (
    <nav
      aria-label={UI.nav.main}
      className={cn(
        "group fixed z-30 flex border-border bg-background-subtle",
        // A bar along the bottom...
        "inset-x-0 bottom-0 flex-row justify-around border-t",
        // ...and, when there is room, a rail down the left that opens over the page. Opening is width only, so nothing moves.
        "lg:inset-y-0 lg:right-auto lg:w-14 lg:flex-col lg:justify-start lg:overflow-hidden lg:border-r lg:border-t-0 lg:py-3",
        "lg:transition-[width] lg:duration-150 lg:hover:w-52 lg:focus-within:w-52 motion-reduce:transition-none",
      )}
    >
      <Link
        href={`/${chain}`}
        className="hidden h-10 items-center gap-3 px-5 font-semibold tracking-tight whitespace-nowrap lg:flex"
      >
        <span aria-hidden="true" className="w-5 shrink-0 text-center text-primary">
          V
        </span>
        <span className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">Vezta Launchpad</span>
      </Link>
      <ul className="flex flex-row justify-around gap-1 lg:mt-3 lg:flex-col lg:justify-start lg:px-2">
        {items.map((item) => {
          const className = cn(
            "flex items-center gap-3 whitespace-nowrap px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "flex-col gap-1 text-[0.65rem] lg:flex-row lg:gap-3 lg:text-sm",
            open === item.page && "bg-accent text-primary",
          );
          const content = (
            <>
              {ICONS[item.page]}
              {/* Drawn always on a phone; on a wide screen only while the rail is open. In the page either way. */}
              <span className="lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 motion-reduce:transition-none">{item.label}</span>
            </>
          );
          return (
            <li key={item.page}>
              {item.href ? (
                <Link href={item.href} aria-current={open === item.page ? "page" : undefined} className={className}>
                  {content}
                </Link>
              ) : (
                <button type="button" onClick={() => requestLogin()} className={cn(className, "w-full")}>
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
