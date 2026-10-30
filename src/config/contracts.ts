import { isAddress } from "@/config/brand";

/*
 * Fliqo contract address on Robinhood Chain.
 *   watch  FliqoWatchBook, no constructor arguments, no owner, does not need the $FLIQO token.
 * Empty => "Sync to chain" runs in practice mode (the list stays in this browser, nothing is sent).
 * Filled => "Sync to chain" sends a real transaction from the user's wallet and any device reads the list back.
 * Check a deployment any time: `npm run verify-deployment -- --book <address> --book-tx <tx>`.
 */
const DEPLOYED = {
  watch: "0x6b7bd113b27169d4dddb79f1381f07cb4d26f0c9",
  /** Block of the FliqoWatchBook deployment (informational). */
  watchBlock: 101518231,
};

/**
 * Local end-to-end tests only: NEXT_PUBLIC_FLIQO_TEST_CONTRACTS='{"watch":"0x…","watchBlock":1}' at build time
 * points a second build at a contract deployed on an anvil chain. Never set it on Vercel.
 */
function testOverride(): typeof DEPLOYED | null {
  const raw = process.env.NEXT_PUBLIC_FLIQO_TEST_CONTRACTS;
  if (!raw) return null;
  try {
    const v = { ...DEPLOYED, ...(JSON.parse(raw) as Partial<typeof DEPLOYED>) };
    return isAddress(v.watch) ? v : null;
  } catch {
    return null;
  }
}

export const CONTRACTS = testOverride() ?? DEPLOYED;

export const watchLive = () => isAddress(CONTRACTS.watch);

export const CONTRACT_NAMES = { watch: "FliqoWatchBook" } as const;

/** Gas of `save` with headroom: 2 tokens measured at ~240k on a Robinhood Chain fork, 50 tokens + full settings ~1.87M. */
export const SAVE_GAS_BASE = 160_000;
export const SAVE_GAS_PER_TOKEN = 30_000;
export const SAVE_GAS_PER_BYTE = 700;
export const saveGasEstimate = (tokens: number, bytes: number) => Math.min(3_000_000, SAVE_GAS_BASE + tokens * SAVE_GAS_PER_TOKEN + bytes * SAVE_GAS_PER_BYTE);
