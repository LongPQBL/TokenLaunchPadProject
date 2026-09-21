"use client";

import { Component, type ReactNode } from "react";

/**
 * If the optional Privy layer cannot start (a bad App ID, a blocked script), fall back to the plain wallet layer rather than
 * a blank page: self-custody must keep working whatever happens to Privy.
 */
export class PrivyBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Privy could not start; continuing with self-custody wallets only", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
