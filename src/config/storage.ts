/*
 * Browser storage keys. Deliberately neutral (not the brand name), so renaming the project never
 * orphans what visitors' browsers already hold: the watchlist, alert thresholds, the wallet choice.
 */
const PREFIX = "fq1";
export const storageKey = (...parts: string[]) => [PREFIX, ...parts].join(".");

/** Every key Fliqo uses in this browser. */
export const KEYS = {
  watchlist: storageKey("watchlist"),
  alerts: storageKey("alerts"),
  alertLog: storageKey("alerts", "log"),
  synced: storageKey("watchlist", "synced"),
  slippage: storageKey("swap", "slippage"),
  compare: storageKey("compare"),
  filter: storageKey("markets", "filter"),
} as const;
