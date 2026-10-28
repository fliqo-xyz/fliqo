import DATA from "@/config/stocks.generated.json";

/*
 * Official Robinhood Stock Tokens on Robinhood Chain, found and checked on chain by scripts/sync-stocks.mjs
 * (beacon in the runtime code, exact symbol, name ending in "Robinhood Token"). Re-run the script to refresh.
 * A Stock Token is a token issued by Robinhood that follows a share's price; it is not the share itself.
 */
export type StockToken = { symbol: string; name: string; token: string; etf: boolean; feed: string | null };

export const STOCKS: StockToken[] = (DATA.stocks as StockToken[]).map((s) => ({ ...s, token: s.token.toLowerCase() }));
export const STOCKS_GENERATED_AT: string = DATA.generatedAt;

const BY_ADDRESS = new Map(STOCKS.map((s) => [s.token, s]));
export const stockOf = (address: string) => BY_ADDRESS.get(address.toLowerCase()) ?? null;
