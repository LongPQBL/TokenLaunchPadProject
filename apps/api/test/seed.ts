import { randomBytes } from "node:crypto";
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

/** A well-formed 40-hex-digit address for tests that go through a route, which validates the format. */
export const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

export interface SeedTradeInput {
  token: string;
  blockNumber: number;
  logIndex: number;
  chainId?: number;
  id?: string;
  trader?: string;
  isBuy?: boolean;
  timestamp?: number;
  quoteAmount?: bigint;
  tokenAmount?: bigint;
  fee?: bigint;
  launchTax?: bigint;
  /** Curve reserves right after the trade. */
  vq?: bigint;
  vt?: bigint;
}

export async function seedTrade(o: SeedTradeInput): Promise<void> {
  const chainId = o.chainId ?? SEPOLIA;
  // The real id is `${chainId}-${txHash}-${logIndex}`, which sorts by transaction hash. A random hash
  // here reproduces that: id order must never be relied on to recover chain order.
  const id = o.id ?? `${chainId}-0x${randomBytes(8).toString("hex")}-${o.logIndex}`;
  await getSql()`
    insert into launchpad.trade (
      id, chain_id, token, trader, is_buy, quote_amount, token_amount, fee, launch_tax,
      virtual_quote_reserves, virtual_token_reserves, "timestamp", block_number, log_index
    ) values (
      ${id}, ${chainId}, ${o.token}, ${o.trader ?? addr(0xbeef)}, ${o.isBuy ?? true},
      ${(o.quoteAmount ?? 1n).toString()}, ${(o.tokenAmount ?? 1n).toString()}, ${(o.fee ?? 0n).toString()}, ${(o.launchTax ?? 0n).toString()},
      ${(o.vq ?? 1n).toString()}, ${(o.vt ?? 1n).toString()}, ${String(o.timestamp ?? 1_700_000_000)}, ${String(o.blockNumber)}, ${o.logIndex}
    )`;
}

export async function seedBalance(o: { token: string; holder: string; amount: bigint; chainId?: number }): Promise<void> {
  await getSql()`
    insert into launchpad.balance (chain_id, token, holder, amount)
    values (${o.chainId ?? SEPOLIA}, ${o.token}, ${o.holder}, ${o.amount.toString()})`;
}
