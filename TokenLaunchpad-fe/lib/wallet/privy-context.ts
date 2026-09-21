"use client";

import { createContext, useContext } from "react";

const PrivyActive = createContext(false);

/** Set by the Privy layer once it is running. Anything that needs Privy's hooks asks first: outside that layer they throw. */
export const PrivyActiveProvider = PrivyActive.Provider;
export const usePrivyActive = () => useContext(PrivyActive);
