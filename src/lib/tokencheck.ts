/*
 * Token facts and the plain-language checks built from them. Shared by the server (which reads the chain) and the
 * pages (which show the result). Checks state what was found and where; they are facts, never a verdict: an owner
 * can change a contract's behaviour after any of these reads, and "nothing found" does not mean "safe".
 */

export type TokenFacts = {
  address: string;
  block: number | null;
  codeSize: number;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  /** owner() answer: an address, "renounced" for the zero address, null when the contract has no owner(). */
  owner: string | null;
  proxy: { implementation: string | null; admin: string | null; beacon: string | null } | null;
  selectors: CodeScan;
  /** Set only for an official Robinhood Stock Token (beacon proxy with the expected name). */
  stockToken: { symbol: string; name: string; etf: boolean } | null;
};

/** Function selectors looked for in the runtime code (PUSH4 operands). */
export const WATCHED = {
  // mint(address,uint256), mint(uint256)
  mint: ["0x40c10f19", "0xa0712d68"],
  // pause()
  pause: ["0x8456cb59"],
  // blacklist(address), addToBlacklist(address), isBlacklisted(address), setBlacklist(address,bool), blockAddress(address), freeze(address)
  blocklist: ["0xf9f92be4", "0x44337ea1", "0xfe575a87", "0x153b0d1e", "0xad2bb1b3", "0x8d1fdf2f"],
  // setFee(uint256), setTaxes(uint256,uint256), setFees(uint256,uint256), setBuyTax(uint256), setSellTax(uint256), updateFees(uint256,uint256), excludeFromFee(address)
  fees: ["0x69fe0e2d", "0xc647b20e", "0x0b78f9c0", "0xdc1052e2", "0x8cd09d50", "0x6db79437", "0x437823ec"],
  // transferOwnership(address)
  ownerTransfer: ["0xf2fde38b"],
  // enableTrading(), openTrading(), setTradingEnabled(bool)
  tradingSwitch: ["0x8a8c523c", "0xc9567bf9", "0xc2e5ec04"],
  // setMaxTxAmount(uint256), setMaxWalletSize(uint256), setMaxWallet(uint256), setMaxTx(uint256)
  limits: ["0xec28438a", "0xea1644d5", "0x5d0044ca", "0xbc337182"],
  // upgradeTo(address), upgradeToAndCall(address,bytes)
  upgrade: ["0x3659cfe6", "0x4f1ef286"],
} as const;
export type CodeScan = { -readonly [K in keyof typeof WATCHED]: boolean };

/** Which watched selectors appear as PUSH4 operands in `code` (hex). Data bytes are skipped like the EVM does. */
export function scanCode(code: string): CodeScan {
  const hex = code.replace(/^0x/, "").toLowerCase();
  const found = new Set<string>();
  for (let i = 0; i < hex.length; i += 2) {
    const op = parseInt(hex.slice(i, i + 2), 16);
    if (op >= 0x60 && op <= 0x7f) {
      const n = op - 0x5f;
      if (n === 4) found.add(`0x${hex.slice(i + 2, i + 10)}`);
      i += n * 2;
    }
  }
  const out = {} as CodeScan;
  for (const k of Object.keys(WATCHED) as (keyof typeof WATCHED)[]) out[k] = WATCHED[k].some((s) => found.has(s));
  return out;
}

export type CheckLevel = "ok" | "note" | "flag";
export type Check = { id: string; level: CheckLevel; title: string; detail: string; source: string };

/** Plain checks from the facts. `native` is ETH (no contract at all). */
export function buildChecks(f: TokenFacts | null, native = false): Check[] {
  if (native) return [{ id: "native", level: "ok", title: "Native asset", detail: "ETH is the chain's own coin: no token contract, no owner, no transfer tax.", source: "Robinhood Chain" }];
  if (!f) return [{ id: "unread", level: "note", title: "Not read yet", detail: "The token contract could not be read. Nothing is known about it.", source: "—" }];
  const c: Check[] = [];
  if (f.codeSize === 0) {
    c.push({ id: "nocode", level: "flag", title: "No contract code", detail: "There is no contract at this address on Robinhood Chain.", source: "eth_getCode" });
    return c;
  }
  if (f.stockToken)
    c.push({
      id: "stock",
      level: "note",
      title: `Official Robinhood Stock Token (${f.stockToken.symbol})`,
      detail: "A token issued by Robinhood that follows a share's price; it is not the share. The issuer can pause transfers, block addresses, upgrade the code and burn from any holder.",
      source: "Beacon proxy + name, read on chain",
    });
  if (f.decimals === null || f.symbol === null) c.push({ id: "erc20", level: "flag", title: "Incomplete ERC-20 metadata", detail: "symbol() or decimals() did not answer. Wallets and DEXes may not handle this token as expected.", source: "ERC-20 reads" });
  else c.push({ id: "erc20", level: "ok", title: "ERC-20 metadata answers", detail: `${f.symbol} · ${f.decimals} decimals${f.totalSupply ? " · supply read" : ""}.`, source: "ERC-20 reads" });
  if (f.owner === null) c.push({ id: "owner", level: "note", title: "No owner() function", detail: "The contract has no owner() read. Control may still sit in another role or contract.", source: "owner()" });
  if (f.owner === "renounced") c.push({ id: "owner", level: "ok", title: "owner() is the zero address", detail: "The contract reports no owner. Other roles may still exist.", source: "owner()" });
  else if (f.owner) c.push({ id: "owner", level: "note", title: "Has an owner", detail: `owner() returns ${f.owner}. Owner powers depend on the code.`, source: "owner()" });
  if (f.proxy) c.push({ id: "proxy", level: "flag", title: "Upgradeable proxy", detail: "The code behind this address can be replaced by whoever controls the proxy.", source: "EIP-1967 slots" });
  if (f.selectors.mint) c.push({ id: "mint", level: "flag", title: "Mint function in the code", detail: "New supply can be created by whoever is allowed to call it.", source: "Bytecode selectors" });
  if (f.selectors.pause) c.push({ id: "pause", level: "flag", title: "Pause function in the code", detail: "Transfers can be stopped by whoever is allowed to call it.", source: "Bytecode selectors" });
  if (f.selectors.blocklist) c.push({ id: "block", level: "flag", title: "Block-list functions in the code", detail: "Specific addresses can be stopped from moving the token.", source: "Bytecode selectors" });
  if (f.selectors.tradingSwitch) c.push({ id: "switch", level: "flag", title: "Trading switch in the code", detail: "A function that turns trading on (and maybe off) exists. Whoever controls it decides when the token can move.", source: "Bytecode selectors" });
  if (f.selectors.limits) c.push({ id: "limits", level: "note", title: "Transaction or wallet limits can be set", detail: "Setters for a maximum transaction or wallet size exist. Large buys or sells may be refused if a limit is lowered.", source: "Bytecode selectors" });
  if (f.selectors.upgrade && !f.proxy) c.push({ id: "upgrade", level: "flag", title: "Upgrade functions in the code", detail: "upgradeTo-style functions are present, so the logic may be replaceable.", source: "Bytecode selectors" });
  if (f.selectors.fees) c.push({ id: "fees", level: "note", title: "Fee or tax setters in the code", detail: "A transfer fee may exist or be changed later. Quotes include what the pool sees, not wallet-level taxes.", source: "Bytecode selectors" });
  if (!c.some((x) => x.level === "flag") && !f.stockToken)
    c.push({ id: "none", level: "ok", title: "No watched functions found", detail: "None of the mint, pause, block-list, trading-switch or upgrade selectors Fliqo looks for appear in the code. That is not a guarantee: checks are facts, never a verdict.", source: "Bytecode selectors" });
  return c;
}

/** What the market lists say about a token: depth, spread over pools, age and recent activity. */
export type MarketInput = { liquidityUsd: number | null; volume24h: number | null; txns24h: number | null; buys24h: number | null; sells24h: number | null; createdAt: number | null; venue: string };

/** Plain market checks from the pools that hold a token (GeckoTerminal). Facts with thresholds shown, never a verdict. */
export function marketChecks(pools: MarketInput[], now = Date.now()): Check[] {
  const src = "GeckoTerminal pools";
  if (!pools.length) return [{ id: "nopools", level: "flag", title: "No listed pool", detail: "No pool holding this token is indexed right now, so there is no market to read or quote.", source: src }];
  const c: Check[] = [];
  const liq = pools.reduce((s, p) => s + (p.liquidityUsd ?? 0), 0);
  const top = Math.max(...pools.map((p) => p.liquidityUsd ?? 0));
  if (liq < 10_000) c.push({ id: "thin", level: "flag", title: "Thin liquidity", detail: `About $${Math.round(liq).toLocaleString("en-US")} across ${pools.length} pool${pools.length === 1 ? "" : "s"} (under $10,000). Small trades can move the price a lot.`, source: src });
  else if (liq < 50_000) c.push({ id: "thin", level: "note", title: "Modest liquidity", detail: `About $${Math.round(liq).toLocaleString("en-US")} across ${pools.length} pool${pools.length === 1 ? "" : "s"} (under $50,000). Check the price impact before a larger trade.`, source: src });
  else c.push({ id: "thin", level: "ok", title: "Liquidity read", detail: `About $${Math.round(liq).toLocaleString("en-US")} across ${pools.length} pool${pools.length === 1 ? "" : "s"}.`, source: src });
  if (pools.length > 1 && liq > 0 && top / liq > 0.9) c.push({ id: "onepool", level: "note", title: "One pool holds most liquidity", detail: `${Math.round((top / liq) * 100)}% of the listed liquidity sits in a single pool.`, source: src });
  const born = pools.map((p) => p.createdAt).filter((t): t is number => t !== null);
  const oldest = born.length ? Math.min(...born) : null;
  if (oldest !== null && now - oldest < 86_400_000) c.push({ id: "young", level: "note", title: "Young market", detail: "The oldest listed pool is less than a day old.", source: src });
  const buys = pools.reduce((s, p) => s + (p.buys24h ?? 0), 0);
  const sells = pools.reduce((s, p) => s + (p.sells24h ?? 0), 0);
  if (buys + sells === 0) c.push({ id: "quiet", level: "note", title: "No swaps in 24 hours", detail: "The listed pools show no buys or sells in the last day.", source: src });
  else if (buys + sells >= 20 && (buys === 0 || sells === 0 || Math.max(buys, sells) / Math.min(buys, sells) > 4)) c.push({ id: "oneway", level: "note", title: "One-sided flow", detail: `${buys.toLocaleString("en-US")} buys and ${sells.toLocaleString("en-US")} sells in 24 hours.`, source: src });
  return c;
}
