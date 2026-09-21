import { getSql } from "../src/db.js";

/**
 * A stand-in for the `launchpad` views schema Ponder maintains in production: the same three tables,
 * with the same column names, types, keys and indexes, copied from the DDL Ponder actually generated
 * (bigint -> numeric(78,0), hex -> text, chain_id/log_index snake_case). Only Ponder's live-query and
 * reorg triggers are left out.
 *
 * API tests run against this so they are deterministic and do not depend on an indexer's timing; the
 * end-to-end suite in apps/indexer is what proves the real Ponder tables look like this.
 */
const DDL = `
create schema if not exists launchpad;

create table if not exists launchpad.token (
  chain_id integer not null,
  address text not null,
  creator text not null,
  quote_token text not null,
  anti_sniper_window integer not null,
  name text,
  ticker text,
  metadata_uri text,
  created_at numeric(78,0) not null,
  virtual_quote_reserves numeric(78,0) not null default 0,
  virtual_token_reserves numeric(78,0) not null default 0,
  progress_bps integer not null default 0,
  volume_quote numeric(78,0) not null default 0,
  trade_count integer not null default 0,
  complete boolean not null default false,
  migrated boolean not null default false,
  pair text,
  constraint token_chain_id_address_pk primary key (chain_id, address)
);
create index if not exists token_chain_id_created_at_index on launchpad.token (chain_id, created_at);
create index if not exists token_chain_id_volume_quote_index on launchpad.token (chain_id, volume_quote);
create index if not exists token_chain_id_progress_bps_index on launchpad.token (chain_id, progress_bps);

create table if not exists launchpad.trade (
  id text primary key,
  chain_id integer not null,
  token text not null,
  trader text not null,
  is_buy boolean not null,
  quote_amount numeric(78,0) not null,
  token_amount numeric(78,0) not null,
  fee numeric(78,0) not null,
  launch_tax numeric(78,0) not null,
  virtual_quote_reserves numeric(78,0) not null,
  virtual_token_reserves numeric(78,0) not null,
  "timestamp" numeric(78,0) not null,
  block_number numeric(78,0) not null,
  log_index integer not null
);
create index if not exists trade_chain_id_token_block_number_log_index_index
  on launchpad.trade (chain_id, token, block_number, log_index);

create table if not exists launchpad.balance (
  chain_id integer not null,
  token text not null,
  holder text not null,
  amount numeric(78,0) not null,
  constraint balance_chain_id_token_holder_pk primary key (chain_id, token, holder)
);
create index if not exists balance_chain_id_token_amount_index on launchpad.balance (chain_id, token, amount);
`;

export async function ensureLaunchpadSchema(): Promise<void> {
  await getSql().unsafe(DDL);
}
