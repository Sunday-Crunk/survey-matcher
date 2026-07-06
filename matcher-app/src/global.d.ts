import type { MatcherApi } from "./types";

declare global {
  interface Window {
    matcher?: MatcherApi;
  }
}

export {};
