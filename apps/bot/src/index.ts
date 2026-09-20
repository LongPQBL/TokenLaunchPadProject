import { loadDeployment } from "@vezta/deployments";
import { chainSlugById } from "@vezta/shared";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadBotConfig } from "./config";
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
});

console.log(`bot ${account.address} watching ${deployment.launchpad} on chain ${deployment.chainId}`);
await migrator.checkBalance();
// Catch up first: anything that filled while the bot was down is migrated before it starts watching.
const caught = await migrator.catchUp();
if (caught.length > 0) console.log(`caught up: migrated ${caught.length} curve(s) that had filled`);

watcher.start(config.pollMs);
// A safety net, on a slow timer: a curve whose Complete event this process somehow missed still gets migrated.
setInterval(() => void migrator.catchUp(BigInt(deployment.deployBlock)).catch((e) => console.error(e)), config.catchUpMinutes * 60_000);
setInterval(() => void migrator.checkBalance(), 60 * 60_000);
