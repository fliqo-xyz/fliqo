import { parseAbi } from "viem";

/*
 * ABIs the site needs. WATCH_ABI mirrors contracts/src/FliqoWatchBook.sol (src/lib/abi.test.ts checks it
 * against the compiled artifact so the two cannot drift apart). The DEX ABIs are the parts of the Uniswap
 * interfaces the site reads.
 */
export const ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

export const FEED_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export const WATCH_ABI = parseAbi([
  "function save(uint32 expectedVersion, address[] tokens, bytes settings) returns (uint32 version)",
  "function clear(uint32 expectedVersion) returns (uint32 version)",
  "function watchlistOf(address owner) view returns (uint32 version, uint64 savedAt, uint64 savedBlock, address[] tokens, bytes settings)",
  "function versionOf(address owner) view returns (uint32)",
  "function countOf(address owner) view returns (uint256)",
  "function ownerCount() view returns (uint256)",
  "function ownersFrom(uint256 start, uint256 limit) view returns (address[] page)",
  "function totalSaves() view returns (uint256)",
  "function chainBlock() view returns (uint64)",
  "function MAX_TOKENS() view returns (uint256)",
  "function MAX_SETTINGS() view returns (uint256)",
  "function MAX_PAGE() view returns (uint256)",
  "event WatchlistSaved(address indexed owner, uint32 indexed version, uint256 count, bytes32 settingsHash, uint64 savedBlock, address[] tokens, bytes settings)",
  "event WatchlistCleared(address indexed owner, uint32 indexed version, uint64 savedBlock)",
  "error StaleVersion(uint32 expected, uint32 current)",
  "error TooManyTokens(uint256 count)",
  "error SettingsTooLarge(uint256 length)",
  "error ZeroToken(uint256 index)",
  "error RepeatedToken(uint256 index)",
  "error PageTooLarge(uint256 limit)",
]);

export const ALL_ERRORS = WATCH_ABI.filter((x) => x.type === "error");

/** Plain words for each custom error, shown instead of a selector. */
export const ERROR_WORDS: Record<string, string> = {
  StaleVersion: "Another device saved a newer version of this watchlist. Load it from chain first, then save again.",
  TooManyTokens: "A watchlist holds at most 50 tokens. Remove some, then save.",
  SettingsTooLarge: "The alert settings are too large to save (1,536 bytes at most). Remove some thresholds.",
  ZeroToken: "The list contains the zero address. Remove it, then save.",
  RepeatedToken: "A token appears twice in the list.",
  PageTooLarge: "Pages hold at most 100 entries.",
};

export const ALLOWANCE_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const PERMIT2_ABI = parseAbi([
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);

export const OWNER_ABI = parseAbi(["function owner() view returns (address)"]);

export const V2_PAIR_ABI = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

export const V3_POOL_ABI = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function liquidity() view returns (uint128)",
]);

export const V3_FACTORY_ABI = parseAbi(["function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)"]);

export const V2_FACTORY_ABI = parseAbi(["function getPair(address tokenA, address tokenB) view returns (address)"]);

export const V2_ROUTER_ABI = parseAbi(["function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)"]);

export const V3_QUOTER_ABI = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

export const V4_QUOTER_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);

export const V4_STATE_VIEW_ABI = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);

export const V4_POSITIONS_ABI = parseAbi([
  "function poolKeys(bytes25 poolId) view returns (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)",
]);
