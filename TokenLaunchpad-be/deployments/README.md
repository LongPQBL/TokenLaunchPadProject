# Deployments

One file per network, written by the contracts repository's deploy script (`script/Deploy.s.sol`) on a real broadcast:

```json
{
  "chainId": 11155111,
  "launchpad": "0x…",          // VeztaLaunchToken: curves, trading, migration, fees
  "factory": "0x…",            // TokenFactory: the only way to create a token
  "weth": "0x…",
  "uniswapV2Router": "0x…", "uniswapV2Factory": "0x…", "pairInitCodeHash": "0x…",
  "deployer": "0x…", "owner": "0x…", "ownershipAccepted": true, "feeRecipient": "0x…",
  "deployBlock": 0,             // start indexing from here
  "deployedAt": 0, "gitCommit": "…"
}
```

There is no file yet: the contracts have not been deployed to a public network. After the first deploy, copy
`deployments/sepolia.json` from the contracts repository here. The examples and the indexer read `deployments/<name>.json`
(`DEPLOYMENT=<name>`).

Never put a local-fork deployment here: its addresses exist only on your machine.
