import { describe, expect, it } from "vitest";
import { parseDeployment } from "./deployment";

const good = {
  chainId: 11155111,
  launchpad: "0x00000000000000000000000000000000000000c3",
  factory: "0x00000000000000000000000000000000000000d4",
  weth: "0x00000000000000000000000000000000000000e5",
};

describe("parseDeployment", () => {
  it("is undefined when the build was given no deployment, so trading can say it is not configured", () => {
    expect(parseDeployment(undefined)).toBeUndefined();
    expect(parseDeployment("")).toBeUndefined();
  });

  it("reads the addresses and chain the build was configured with", () => {
    expect(parseDeployment(JSON.stringify(good))).toEqual(good);
  });

  it("ignores fields the app does not use, such as the deployer or the owner", () => {
    expect(parseDeployment(JSON.stringify({ ...good, owner: "0x1", deployedAt: 1 }))).toEqual(good);
  });

  it("refuses a malformed deployment loudly: a wrong address here would send money to the wrong contract", () => {
    expect(() => parseDeployment(JSON.stringify({ ...good, launchpad: "0x123" }))).toThrow(/NEXT_PUBLIC_DEPLOYMENT/);
    expect(() => parseDeployment("not json")).toThrow(/NEXT_PUBLIC_DEPLOYMENT/);
    expect(() => parseDeployment(JSON.stringify({ chainId: 1 }))).toThrow(/NEXT_PUBLIC_DEPLOYMENT/);
  });
});
