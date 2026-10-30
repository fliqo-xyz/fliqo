# Fliqo

Fliqo is a trading intelligence site for Robinhood Chain. Most token pages show a price and a Buy button; Fliqo helps a trader understand what they are about to trade first: which pools hold the token and how deep they are, what the token's contract allows its owner to do, how it compares with another market, and what a swap would really return after fees and price impact. It does this with public market data and direct reads from the chain, and it never touches funds: the swap itself always happens in the trader's own wallet, on Pons or on the pool's venue.

See Beyond the Chart. Explore tokens. Compare markets. Make your move.

## Read this before anything else

This repository is the working code behind https://fliqo.xyz.

- **What runs today.** Token Discovery (live market grid, search, filters), a swap tape of the pools with the most trades in the last hour, a token page with Token Checks (contract configuration read from chain plus market checks from the pools), a sell check, the token's HoodLock lock status, a live chart, a Swap Route Preview, Market Comparison ("Flip the View": two tokens or two pools side by side with both price lines rebased to the same start), a Liquidity Overview per venue and per paired asset, a Watchlist with alert thresholds checked in the open tab and an optional on-chain copy, and Wallet Activity (balances and recent token transfers of a wallet).
- **What reads live data.** Pool lists, prices, volumes, candles and swaps come from GeckoTerminal's public API for Robinhood Chain (no key), cached on the server. Contract facts, quotes, balances, transfers, the block, gas and the Chainlink ETH / USD price are read from Robinhood Chain itself. Every number names its source; a number nobody published shows as "—".
- **Quotes are simulations, not trades.** The route preview asks the Uniswap v2, v3 and v4 quoter contracts on chain 4663 (single pool or two hops through WETH or USDG) and, for a token still on a Pons bonding curve, the curve's own buy function, all with `eth_call`. Nothing is signed or sent; the Swap button opens Pons or the pool page.
- **The sell check is a simulation too.** One `eth_call` places a read-only helper contract (`FliqoSellProbe`, never deployed) at a fixed address through a state override, buys about $5 of the token in one of its pools and sells it all back, then reports the buy tax, sell tax and round-trip loss it measured. It can fail to reach a verdict (for example a pool that runs out of the gas cap both ways); the page then says "not simulated" instead of guessing. A clean simulation now does not mean a sale will work later: the token's owner may still be able to change the rules.
- **The contract.** `FliqoWatchBook` lets a wallet save its watchlist and thresholds as one public, versioned record so the same list opens on another device. It is **deployed on Robinhood Chain** and verified on Blockscout (address below). Saving is optional: without a wallet the watchlist stays in the browser and can be moved with a file export.
- **Planned, not built.** Premium analytics, monitoring and alerts while the tab is closed, a developer API, and $FLIQO utility (analytics credits, premium monitoring, alerts, API access). Nothing in this repository is a safety guarantee for any token, a promise of value for $FLIQO, or financial advice. Checks are facts, never a verdict.

## Layout

| Path | What it is |
|---|---|
| `src/app/` | Pages (markets, token page, compare, watchlist, portfolio, pools, how it works, token) and API routes (market lists, swap tape, overview, token facts, pool detail, quotes, prices, sparklines, wallet, transfers, activity, chain snapshot, read relay, sell check, locks). |
| `src/components/` | Interface components: shell, market grid, token page, route preview, compare view, watchlist and on-chain sync, wallet dialog. |
| `src/config/` | `brand.ts` (name, ticker, token address, links, chain), `contracts.ts` (deployed contract address), `dex.ts` (Uniswap addresses on chain 4663), `assets.ts` (every image path). |
| `src/lib/` | Chain reads, GeckoTerminal client and its shared cache, quote builder, token checks, sell check, lock reads, watchlist encoding, comparison math, rate limits, and their unit tests (`src/lib/contracts/` holds the compiled contract artifacts). |
| `contracts/` | Solidity sources (`src/FliqoWatchBook.sol`, `src/FliqoSellProbe.sol`) and Foundry tests (`test/`: unit, fuzz, invariant, fork). |
| `scripts/` | `verify-deployment`, the contract artifact builders and the token logo sync. |
| `public/` | Brand images, wallet logos and token logos. |

## Run the tests

Node.js 20 or newer.

```
npm install
npm run typecheck
npm test
```

Contracts use [Foundry](https://book.getfoundry.sh/):

```
cd contracts
bash setup.sh
forge test --no-match-path 'test/fork/*'
forge test --match-path 'test/fork/*' --fork-url https://robinhood-rpc.publicnode.com
```

### What was checked for this snapshot

- 30 Oct 2026 (UTC), Node.js 25.8.2, forge 1.5.1-stable: `npm run typecheck` exit 0; `npm test` 96 pass / 0 fail; `npm run build` 31 routes; `forge test --no-match-path 'test/fork/*'` 31 passed (FliqoWatchBookTest 20 including 3 fuzz tests, FliqoSellProbeTest 8, FliqoWatchBookInvariantTest 3 invariants); 3 fork tests passed against the Robinhood Chain head through the publicnode endpoint; `forge coverage` of `FliqoWatchBook.sol` 100% lines and branches. `npm run verify-deployment` against the live FliqoWatchBook printed MATCH, and `npm run contracts:artifacts -- --check` and `node scripts/probe-artifact.mjs --check` both confirmed the committed artifacts match a fresh `forge build`.
- Not run for this snapshot: the browser tests on a local chain (they passed 7 of 7 on 29 Oct 2026 and are not part of this repository). `FliqoSellProbe` unit tests cover only its v2 path with a mock pair (line coverage 39%); its v3, v4 and Pons curve paths were checked only through live `/api/sellcheck` answers on 30 Oct 2026.

## Look at the site

```
npm install
npm run build
npm start
```

Open http://localhost:5930. Everything works with no configuration: markets, token pages, checks, quotes, comparison, watchlist and wallet reads use public endpoints. Without `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` the WalletConnect option says "Not configured on this site yet"; without `BLOCKSCOUT_API_KEY` the portfolio shows token transfers read from chain logs but not the full transaction history; without `KV_REST_API_URL` each server instance keeps its own cache and limits.

## Contracts

| Contract | Address | Explorer |
|---|---|---|
| FliqoWatchBook | `0x6b7bd113b27169d4dddb79f1381f07cb4d26f0c9` | [Blockscout](https://robinhoodchain.blockscout.com/address/0x6b7bd113b27169d4dddb79f1381f07cb4d26f0c9) (verified) |
| FliqoSellProbe | never deployed (placed by state override inside `eth_call` only) | — |

FliqoWatchBook was deployed at block 101,518,231 in transaction `0x0b509290d39398cdfc0eea7de05c876926d58db56116e0b6213b8b67c68827da`.

`FliqoWatchBook` keeps one record per wallet: up to 50 token addresses and up to 1,536 bytes of alert thresholds, with a version number. `save(expectedVersion, tokens, settings)` only succeeds when `expectedVersion` is the current version, so an older device cannot overwrite a newer list; `clear(expectedVersion)` empties it. Anyone can read any record with `watchlistOf(owner)`; everything saved is public. The contract has no constructor arguments, no owner, no admin, no fee, no pause, no upgrade path, and holds no funds (it has no payable function, so ETH sent to it is refused).

`FliqoSellProbe` is the helper behind the sell check. It exists only for the length of one simulated call: the server passes its runtime code (`src/lib/contracts/probe.json`) as a state override, so it never holds funds and nobody can call it on chain.

## Verify a deployment

```
npm run verify-deployment -- --book 0x6b7bd113b27169d4dddb79f1381f07cb4d26f0c9 --book-tx 0x0b509290d39398cdfc0eea7de05c876926d58db56116e0b6213b8b67c68827da
```

The script compares the bytecode on Robinhood Chain with the build in this repository and prints MATCH or the first difference. `npm run contracts:artifacts -- --check` proves the committed artifact file is a fresh `forge build`.

## Add the network to your wallet

| Field | Value |
|---|---|
| Network | Robinhood Chain |
| Chain ID | 4663 |
| Currency | ETH |
| RPC | https://rpc.mainnet.chain.robinhood.com |
| Explorer | https://robinhoodchain.blockscout.com |

The site offers to add it when you connect.

## Data sources and limits

- **GeckoTerminal public API** (network `robinhood`): pool lists (busiest, trending, new), token pools, candles, recent swaps, token prices. Cached on the server (lists 3 minutes, details 2 minutes, swaps 45 seconds) with a per-minute outbound cap; when the API is busy the last answer is shown and marked "delayed", and a section with nothing cached says so instead of showing zeros.
- **Robinhood Chain RPC** (the public endpoint, with public fallbacks): contract code and ERC-20 reads, `owner()`, proxy slots, bytecode selectors, quoter simulations, balances, the block, gas and Chainlink ETH / USD. Every call into a contract a visitor chose is gas-capped and budgeted per network and site-wide.
- **Swap tape** ranks pools by trades in the last hour (one pool per token, pairs of two hub tokens last). A pool whose newest trade is more than two hours old is swapped for another candidate once; the tape shows when it was updated and when the newest swap happened, and says "delayed" when the data is old.
- **Shared cache (optional).** With `KV_REST_API_URL` and `KV_REST_API_TOKEN` set, server instances share GeckoTerminal answers, a site-wide per-minute budget and a pause after a 429, plus the sell-check (5 minutes) and lock (10 minutes) answers. If the store fails, each instance falls back to its own memory.
- **Sell check** (`/api/sellcheck/<token>`): the simulated buy and sell described above, with an 8M gas cap, cached 5 minutes. Pools paired with USDG or another token get a temporary balance written by state override; the storage slot is accepted only after `balanceOf` echoes a test value. Answers are facts from one simulation at one block, not a guarantee.
- **HoodLock locks** (`/api/locks/<token>`): `Locked` events of the HoodLock locker for the token itself and up to three v2 LP pairs, each lock re-read with `getLock` so withdrawn locks drop out; where the RPC refuses the log query the server reads every lock id instead and the answer says which method was used. v3, v4 and curve pools have no ERC-20 LP token to lock, and the page says so.
- **Token transfers** are `eth_getLogs` queries for the ERC-20 Transfer event to or from the wallet, in windows of 25,000 blocks over the most recent ~100,000 blocks (about three hours). Plain ETH transfers leave no logs and are not shown without the optional indexer.
- **Not read:** top holders (an indexer would be needed; shown as "—"), a circulating supply nobody published (market cap falls back to fully diluted value and says so), anything about a token's team or plans.

## Token

$FLIQO is the community token of Fliqo on Robinhood Chain. It has **not launched yet** (as of 30 Oct 2026); the contract address will be announced on https://fliqo.xyz and https://x.com/fliqoxyz at launch, and it launches on Pons. Until then, any token presented as $FLIQO is not this one. The site itself does not need the token. It has no promised value. Its planned utility (analytics credits, premium monitoring and alerts, API access) is planned, not live.

## Deploy your own

1. Import the repository into a Next.js host (framework preset Next.js, root `./`, Node.js 20 or newer).
2. Optional environment variables (names and formats only; none is required):

| Variable | What it is for | Format |
|---|---|---|
| `ROBINHOOD_RPC_URL` | Server reads from a private Robinhood Chain endpoint | https URL |
| `NEXT_PUBLIC_ROBINHOOD_RPC_URL` | Browser fallback endpoint | https URL |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect option in the wallet dialog | 32 hex characters |
| `BLOCKSCOUT_API_KEY` | Full transaction history on the portfolio page | starts with `proapi_` |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Shared rate-limit counters, GeckoTerminal cache and budget, sell-check and lock caches across server instances (keys start with `fliqo:`) | https URL, token string |

3. Point the domain at the host. After the deploy, `/` answers 200, `/api/chain` returns JSON with a block number, and `/api/market` returns token rows.
4. Contract: the repository points at the deployed FliqoWatchBook above. To use your own, deploy `FliqoWatchBook` (no constructor arguments) from your own wallet, put its address and block into `src/config/contracts.ts`, then run `npm run verify-deployment`.

## Contributing

Fork the repository, branch from `main`, and run `npm run typecheck`, `npm test` and `npm run build`, and `bash setup.sh && forge test` in `contracts/` before opening a pull request. For a bug, open an issue with the expected and actual behavior and minimal steps. Keep private keys, seed phrases and environment values out of issues.

## Security

Please do not open a public issue for a suspected vulnerability. Use GitHub private vulnerability reporting: open the **Security** tab of this repository and choose **Report a vulnerability**. The contracts, the API routes (including the read relay, the sell check and their limits) and the transaction the site builds for a watchlist save are in scope; wallets, RPC providers, explorers, GeckoTerminal, DEXes and Pons are not. There is no bug bounty.

## Notices and license

This project's original code is released under the [MIT License](LICENSE). Wallet logos in `public/wallets/` belong to their projects and are used only to identify the wallet; token logos in `public/tokens/` belong to their token projects and are shown only to identify the token. The Inter typeface is loaded through `next/font` under the SIL Open Font License. npm dependencies keep their own licenses. The Fliqo name, logo and artwork belong to the project and are not licensed for reuse as a brand.
