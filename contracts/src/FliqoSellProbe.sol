// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/*
 * FliqoSellProbe: a read-only helper that is NEVER deployed. The site's server places its runtime code at a
 * throwaway address for one eth_call (a state override, together with a balance for the quote side), so the call
 * runs a real buy and then a real sell of a small amount against the live pool, and returns what moved. Nothing is
 * sent or signed and nothing stays on chain.
 *
 * Each step reports, on token balances:
 *   sent      what left the probe        arrived   what the pool or pool manager received (0 = not measured)
 *   poolOut   what the pool released     received  what reached the probe
 * so a transfer tax shows as sent > arrived (paying in) or poolOut > received (paying out), apart from pool fees.
 * A step that reverts returns its revert data; TaxedTransfer is raised when a pool would refuse a short payment.
 *
 * Venues: 1 = Uniswap v2 style pair, 2 = Uniswap v3 style pool, 3 = Uniswap v4 pool, 4 = Pons bonding curve.
 * address(0) stands for native ETH (v4 native pools and the curve).
 */

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}

interface IWETHMin {
    function deposit() external payable;
}

interface IV2Pair {
    function token0() external view returns (address);
    function getReserves() external view returns (uint112, uint112, uint32);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

interface IV3Pool {
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external
        returns (int256, int256);
}

interface ICurve {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256);
    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256);
}

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

interface IPoolManager {
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256);
    function sync(address currency) external;
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
}

contract FliqoSellProbe {
    error TaxedTransfer(uint256 owed, uint256 arrived);
    error OnlySelf();
    error NotThePool();
    error NoQuoteBalance(uint256 have, uint256 need);
    error TransferFailed();

    struct Leg {
        bool ok;
        uint256 sent;
        uint256 arrived;
        uint256 poolOut;
        uint256 received;
        uint256 gas;
        bytes err;
    }

    uint160 internal constant MIN_SQRT = 4295128739;
    uint160 internal constant MAX_SQRT = 1461446703485210103287273052203988822378723970342;

    // Set for the duration of one swap so callbacks can check who calls them.
    address internal _pool;
    address internal _payToken;
    uint256 internal _arrived;

    receive() external payable {}

    /**
     * Buys with `quoteIn` of `quote`, then sells everything received back to `quote`. With `sellAmount` > 0 the buy
     * is skipped and `sellAmount` of `token` (given to the probe by a state override) is sold instead.
     * `weth` is wrapped from the probe's ETH when the quote is WETH and the probe holds too little of it.
     */
    function run(uint8 kind, bytes calldata venue, address token, address quote, address weth, uint256 quoteIn, uint256 sellAmount)
        external
        payable
        returns (Leg memory buy, Leg memory sell)
    {
        uint256 amount = sellAmount;
        if (amount == 0) {
            if (quote != address(0) && quote == weth) {
                uint256 have = IERC20Min(quote).balanceOf(address(this));
                if (have < quoteIn && address(this).balance >= quoteIn - have) IWETHMin(weth).deposit{value: quoteIn - have}();
            }
            buy = _leg(kind, venue, quote, token, quoteIn);
            if (!buy.ok) return (buy, sell);
            amount = buy.received;
        }
        sell = _leg(kind, venue, token, quote, amount);
    }

    function _leg(uint8 kind, bytes calldata venue, address tin, address tout, uint256 amt) internal returns (Leg memory l) {
        uint256 g = gasleft();
        try this.step(kind, venue, tin, tout, amt) returns (Leg memory r) {
            l = r;
            l.ok = true;
        } catch (bytes memory e) {
            l.err = e;
        }
        l.gas = g - gasleft();
    }

    /// One swap of `amt` of `tin` for `tout`. Only the probe itself may call it (so a failure reverts just this step).
    function step(uint8 kind, bytes calldata venue, address tin, address tout, uint256 amt) external returns (Leg memory l) {
        if (msg.sender != address(this)) revert OnlySelf();
        uint256 have = _bal(tin, address(this));
        if (have < amt) revert NoQuoteBalance(have, amt);
        if (kind == 1) return _v2(abi.decode(venue, (address)), tin, tout, amt);
        if (kind == 2) return _v3(abi.decode(venue, (address)), tin, tout, amt);
        if (kind == 3) {
            (address pm, PoolKey memory key) = abi.decode(venue, (address, PoolKey));
            return _v4(pm, key, tin, tout, amt);
        }
        return _curve(abi.decode(venue, (address)), tin, tout, amt);
    }

    // ---- Uniswap v2 style: pay the pair, then ask for the constant-product output at a 0.3% fee. ----
    function _v2(address pair, address tin, address tout, uint256 amt) internal returns (Leg memory l) {
        bool inIs0 = IV2Pair(pair).token0() == tin;
        uint256 selfBefore = _bal(tin, address(this));
        uint256 pairBefore = _bal(tin, pair);
        _send(tin, pair, amt);
        l.sent = selfBefore - _bal(tin, address(this));
        uint256 pairNow = _bal(tin, pair);
        l.arrived = pairNow - pairBefore;
        // Nothing reached the pair: the pair would pay nothing, so say why instead of the pair's own error.
        if (l.sent > 0 && l.arrived == 0) revert TaxedTransfer(l.sent, 0);
        (uint112 r0, uint112 r1,) = IV2Pair(pair).getReserves();
        (uint256 rin, uint256 rout) = inIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        uint256 actualIn = pairNow - rin;
        uint256 out = (actualIn * 997 * rout) / (rin * 1000 + actualIn * 997);
        l.poolOut = out;
        uint256 outBefore = _bal(tout, address(this));
        IV2Pair(pair).swap(inIs0 ? 0 : out, inIs0 ? out : 0, address(this), "");
        l.received = _bal(tout, address(this)) - outBefore;
    }

    // ---- Uniswap v3 style: exact input, paid in the swap callback. ----
    function _v3(address pool, address tin, address tout, uint256 amt) internal returns (Leg memory l) {
        bool zf = tin < tout;
        _pool = pool;
        _payToken = tin;
        _arrived = 0;
        uint256 selfBefore = _bal(tin, address(this));
        uint256 outBefore = _bal(tout, address(this));
        (int256 a0, int256 a1) = IV3Pool(pool).swap(address(this), zf, int256(amt), zf ? MIN_SQRT + 1 : MAX_SQRT - 1, "");
        l.sent = selfBefore - _bal(tin, address(this));
        l.arrived = _arrived;
        int256 o = zf ? a1 : a0;
        l.poolOut = o < 0 ? uint256(-o) : 0;
        l.received = _bal(tout, address(this)) - outBefore;
        _pool = address(0);
    }

    function _pay(int256 a0, int256 a1) internal {
        if (msg.sender != _pool || _pool == address(0)) revert NotThePool();
        uint256 owed = uint256(a0 > 0 ? a0 : a1);
        uint256 before = _bal(_payToken, msg.sender);
        _send(_payToken, msg.sender, owed);
        uint256 arrived = _bal(_payToken, msg.sender) - before;
        _arrived = arrived;
        if (arrived < owed) revert TaxedTransfer(owed, arrived);
    }

    function uniswapV3SwapCallback(int256 a0, int256 a1, bytes calldata) external {
        _pay(a0, a1);
    }

    function pancakeV3SwapCallback(int256 a0, int256 a1, bytes calldata) external {
        _pay(a0, a1);
    }

    /// Forks of v3 that name their callback differently call (int256, int256, bytes) under another selector.
    fallback(bytes calldata data) external payable returns (bytes memory) {
        if (msg.sender != _pool || _pool == address(0) || data.length < 68) revert NotThePool();
        (int256 a0, int256 a1) = abi.decode(data[4:68], (int256, int256));
        _pay(a0, a1);
        return "";
    }

    // ---- Uniswap v4: swap inside unlock, settle the input, take the output. ----
    function _v4(address pm, PoolKey memory key, address tin, address tout, uint256 amt) internal returns (Leg memory l) {
        bool zf = tin == key.currency0;
        _pool = pm;
        uint256 outBefore = _bal(tout, address(this));
        bytes memory r = IPoolManager(pm).unlock(abi.encode(key, zf, amt, tin, tout));
        (l.sent, l.arrived, l.poolOut) = abi.decode(r, (uint256, uint256, uint256));
        l.received = _bal(tout, address(this)) - outBefore;
        _pool = address(0);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != _pool || _pool == address(0)) revert NotThePool();
        (PoolKey memory key, bool zf, uint256 amt, address tin, address tout) = abi.decode(data, (PoolKey, bool, uint256, address, address));
        IPoolManager pm = IPoolManager(msg.sender);
        int256 d = pm.swap(key, SwapParams(zf, -int256(amt), zf ? MIN_SQRT + 1 : MAX_SQRT - 1), "");
        int128 d0 = int128(d >> 128);
        int128 d1 = int128(d);
        int128 dIn = zf ? d0 : d1;
        int128 dOut = zf ? d1 : d0;
        uint256 owe = dIn < 0 ? uint256(uint128(-dIn)) : 0;
        uint256 get = dOut > 0 ? uint256(uint128(dOut)) : 0;
        uint256 sent;
        uint256 arrived;
        if (owe > 0) {
            if (tin == address(0)) {
                pm.settle{value: owe}();
                sent = owe;
                arrived = owe;
            } else {
                pm.sync(tin);
                uint256 b = _bal(tin, address(this));
                _send(tin, address(pm), owe);
                sent = b - _bal(tin, address(this));
                arrived = pm.settle();
                if (arrived < owe) revert TaxedTransfer(owe, arrived);
            }
        }
        if (get > 0) pm.take(tout, address(this), get);
        return abi.encode(sent, arrived, get);
    }

    // ---- Pons bonding curve (ETH paired): buy() takes ETH, sell() pulls the token with an allowance. ----
    function _curve(address curve, address tin, address tout, uint256 amt) internal returns (Leg memory l) {
        uint256 selfBefore = _bal(tin, address(this));
        uint256 outBefore = _bal(tout, address(this));
        if (tin == address(0)) {
            l.poolOut = ICurve(curve).buy{value: amt}(amt, 0, address(this));
            l.arrived = amt;
        } else {
            IERC20Min(tin).approve(curve, amt);
            uint256 curveBefore = _bal(tin, curve);
            l.poolOut = ICurve(curve).sell(amt, 0, address(this));
            uint256 curveNow = _bal(tin, curve);
            // A curve that burns what it buys back holds no more than before: then arrival is not measured (0).
            l.arrived = curveNow > curveBefore ? curveNow - curveBefore : 0;
        }
        l.sent = selfBefore - _bal(tin, address(this));
        l.received = _bal(tout, address(this)) - outBefore;
    }

    // ---- helpers ----
    function _bal(address token, address who) internal view returns (uint256) {
        if (token == address(0)) return who.balance;
        return IERC20Min(token).balanceOf(who);
    }

    function _send(address token, address to, uint256 amt) internal {
        (bool ok, bytes memory r) = token.call(abi.encodeWithSelector(IERC20Min.transfer.selector, to, amt));
        if (!ok) {
            assembly {
                revert(add(r, 32), mload(r))
            }
        }
        if (r.length > 0 && !abi.decode(r, (bool))) revert TransferFailed();
    }
}
