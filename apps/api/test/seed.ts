import { getSql } from "../src/db.js";

const SEPOLIA = 11155111;

export interface SeedTokenInput {
  address: string;
  chainId?: number;
  name?: string;
  ticker?: string;
  creator?: string;
  metadataUri?: string;
  createdAt?: number; // unix seconds
  volumeQuote?: bigint;
  progressBps?: number;
  tradeCount?: number;
  complete?: boolean;
  migrated?: boolean;
  pair?: string;
  virtualQuoteReserves?: bigint;
  virtualTokenReserves?: bigint;
}

/** Inserts one row into launchpad.token. Amounts are passed as strings: they are uint256 values. */
async function insertToken(o: SeedTokenInput): Promise<void> {
  await getSql()`
    insert into launchpad.token (
      chain_id, address, creator, quote_token, anti_sniper_window, name, ticker, metadata_uri, created_at,
      virtual_quote_reserves, virtual_token_reserves, progress_bps, volume_quote, trade_count, complete, migrated, pair
    ) values (
      ${o.chainId ?? SEPOLIA}, ${o.address}, ${o.creator ?? "0xc0ffee"}, ${"0xweth"}, ${0},
      ${o.name ?? null}, ${o.ticker ?? null}, ${o.metadataUri ?? null}, ${String(o.createdAt ?? Math.floor(Date.now() / 1000))},
      ${(o.virtualQuoteReserves ?? 0n).toString()}, ${(o.virtualTokenReserves ?? 0n).toString()},
      ${o.progressBps ?? 0}, ${(o.volumeQuote ?? 0n).toString()}, ${o.tradeCount ?? 0},
      ${o.complete ?? false}, ${o.migrated ?? false}, ${o.pair ?? null}
    )`;
}

async function reset(): Promise<void> {
  await getSql()`truncate launchpad.token, launchpad.trade, launchpad.balance`;
}

export const seedToken = Object.assign(insertToken, { reset });
