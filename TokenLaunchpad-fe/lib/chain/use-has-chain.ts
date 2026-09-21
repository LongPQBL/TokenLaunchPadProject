"use client";

import { useContext } from "react";
import { WagmiContext } from "wagmi";

/**
 * Whether there is a wallet layer to ask the chain through. Everywhere in the app there is; a component that would otherwise fail
 * without one (the hooks need it) can ask first, and draw what it can without a price instead.
 */
export const useHasChain = () => useContext(WagmiContext) !== undefined;
