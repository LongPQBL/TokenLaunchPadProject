import { makeContext } from "./clients.ts";
import { newChallenge, verifyLogin } from "./siwe.ts";

const ctx = makeContext();
const user = ctx.randomWallet();
const domain = "launchpad.example.com";

const { nonce, message } = newChallenge({ address: user.account.address, chainId: ctx.chain.id, domain, uri: `https://${domain}` });
const signature = await user.signMessage({ message }); // step 2 (frontend): the wallet signs

const good = await verifyLogin(ctx.publicClient, { message, signature, domain, nonce });
const wrongNonce = await verifyLogin(ctx.publicClient, { message, signature, domain, nonce: "another-nonce" });
const wrongDomain = await verifyLogin(ctx.publicClient, { message, signature, domain: "evil.example.com", nonce });
const other = ctx.randomWallet();
const forged = await verifyLogin(ctx.publicClient, { message, signature: await other.signMessage({ message }), domain, nonce });

console.log({ good: good === user.account.address, wrongNonce, wrongDomain, forged });
if (good !== user.account.address || wrongNonce || wrongDomain || forged) process.exit(1);
console.log("OK: valid login accepted; wrong nonce, wrong domain and forged signature rejected");
