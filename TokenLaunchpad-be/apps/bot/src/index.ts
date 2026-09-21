import { loadDeployment } from "@vezta/deployments";
import { chainSlugById, HEARTBEAT_EVERY_SECONDS } from "@vezta/shared";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadBotConfig } from "./config";
import { createHeartbeat } from "./heartbeat";
import { createMigrator } from "./migrate";
import { createRedisPublisher } from "./publish";
import { createWatcher } from "./watcher";

/**
 * The one process that follows the chain (spec §6): it publishes what it sees to Redis for the API's websockets, and it
 * migrates curves that fill, because it already watches Complete. If it dies, realtime stops and migration waits, REST keeps
 * working, and starting it again catches up on everything it missed.
 */
const config = loadBotConfig();
const deployment = loadDeployment();
const chain = defineChain({
  id: deployment.chainId,
  name: chainSlugById(deployment.chainId) ?? `chain-${deployment.chainId}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});
const account = privateKeyToAccount(config.privateKey);
const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
const walletClient = createWalletClient({ chain, account, transport: http(config.rpcUrl) });

const migrator = createMigrator({
  publicClient,
  walletClient,
  account: account.address,
  signer: account,
  launchpad: deployment.launchpad,
  deployBlock: BigInt(deployment.deployBlock),
  logRange: config.logRange,
});

const publisher = config.redisUrl ? createRedisPublisher(config.redisUrl) : undefined;
if (!publisher) console.warn("REDIS_URL is not set: events are not published, so pages will poll instead of receiving live updates");

const watcher = createWatcher({
  publicClient,
  launchpad: deployment.launchpad,
  factory: deployment.factory,
  chain: chainSlugById(deployment.chainId) ?? String(deployment.chainId),
  publish: (channel, message) => (publisher ? publisher.publish(channel, message) : Promise.resolve()),
  migrator,
  logRange: config.logRange,
});

console.log(`bot ${account.address} watching ${deployment.launchpad} on chain ${deployment.chainId}`);
await migrator.checkBalance();
// Catch up first: anything that filled while the bot was down is migrated before it starts watching.
// An RPC that fails here must not take the whole bot down: the watcher below and the timer at the end try again.
try {
  const caught = await migrator.catchUp();
  if (caught.length > 0) console.log(`caught up: migrated ${caught.length} curve(s) that had filled`);
} catch (e) {
  console.error("catch-up failed, it will be retried on the timer:", e instanceof Error ? e.message : e);
}

watcher.start(config.pollMs);
// Tells the admin page this process is alive and what its wallet holds. Without Redis there is nowhere to say it.
if (publisher) {
  createHeartbeat({
    chain: chainSlugById(deployment.chainId) ?? String(deployment.chainId),
    address: account.address,
    getBalance: () => publicClient.getBalance({ address: account.address }),
    set: (key, value, ttl) => publisher.set(key, value, ttl),
  }).start(HEARTBEAT_EVERY_SECONDS);
}
// A safety net, on a slow timer: a curve whose Complete event this process somehow missed still gets migrated.
setInterval(() => void migrator.catchUp(BigInt(deployment.deployBlock)).catch((e) => console.error(e)), config.catchUpMinutes * 60_000);
setInterval(() => void migrator.checkBalance(), 60 * 60_000);
