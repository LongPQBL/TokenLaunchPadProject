import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Without this the DOM of one test is still there for the next.
afterEach(() => cleanup());
