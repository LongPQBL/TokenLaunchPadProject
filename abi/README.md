# ABIs

Generated from the compiled contracts by `./script/export-abi.sh` in the contracts repository
([Vezta-contract-tokenLaunchpad](https://github.com/LongPQBL/Vezta-contract-tokenLaunchpad)); do not edit by hand.

- `*.json`: plain ABIs (`TokenFactory`, `VeztaLaunchToken`, `Token`).
- `index.ts`: the same ABIs as `as const` TypeScript (`tokenFactoryAbi`, `launchpadAbi`, `tokenAbi`) so viem and wagmi infer
  exact types.

To update after a contract change: run the export script in the contracts repo, copy `abi/` here, commit. The contracts
repo's CI can run `./script/export-abi.sh --check` to catch stale files.
