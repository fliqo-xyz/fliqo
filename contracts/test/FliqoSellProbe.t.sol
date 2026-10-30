// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FliqoSellProbe} from "../src/FliqoSellProbe.sol";

/// ERC-20 with an optional transfer tax on trades with `pair` and an optional sell block (a honeypot pattern).
contract TaxToken {
    string public name = "T";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public taxBps;
    bool public blockSells;
    address public pair;
    address public deployer = msg.sender;

    function set(uint256 bps, bool blocked, address p) external {
        taxBps = bps;
        blockSells = blocked;
        pair = p;
    }

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        _move(msg.sender, to, a);
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a;
        _move(f, to, a);
        return true;
    }

    function _move(address f, address to, uint256 a) internal {
        if (blockSells && to == pair && f != deployer) revert("Sells are paused");
        balanceOf[f] -= a;
        uint256 tax = (f == pair || to == pair) ? (a * taxBps) / 10_000 : 0;
        balanceOf[to] += a - tax;
        balanceOf[address(0xdead)] += tax;
    }
}

/// Minimal constant-product pair (0.3% fee, K check) in the Uniswap v2 shape.
contract MockPair {
    address public token0;
    address public token1;
    uint112 internal r0;
    uint112 internal r1;

    constructor(address a, address b) {
        (token0, token1) = a < b ? (a, b) : (b, a);
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (r0, r1, 0);
    }

    function sync() public {
        r0 = uint112(TaxToken(token0).balanceOf(address(this)));
        r1 = uint112(TaxToken(token1).balanceOf(address(this)));
    }

    function swap(uint256 o0, uint256 o1, address to, bytes calldata) external {
        if (o0 > 0) TaxToken(token0).transfer(to, o0);
        if (o1 > 0) TaxToken(token1).transfer(to, o1);
        uint256 b0 = TaxToken(token0).balanceOf(address(this));
        uint256 b1 = TaxToken(token1).balanceOf(address(this));
        uint256 in0 = b0 > r0 - o0 ? b0 - (r0 - o0) : 0;
        uint256 in1 = b1 > r1 - o1 ? b1 - (r1 - o1) : 0;
        require(in0 > 0 || in1 > 0, "INSUFFICIENT_INPUT");
        require((b0 * 1000 - in0 * 3) * (b1 * 1000 - in1 * 3) >= uint256(r0) * r1 * 1e6, "K");
        sync();
    }
}

contract FliqoSellProbeTest is Test {
    FliqoSellProbe probe;
    TaxToken quote;
    TaxToken token;
    MockPair pair;

    function setUp() public {
        probe = new FliqoSellProbe();
        quote = new TaxToken();
        token = new TaxToken();
        pair = new MockPair(address(quote), address(token));
        quote.mint(address(pair), 100 ether);
        token.mint(address(pair), 1_000_000 ether);
        pair.sync();
        quote.mint(address(probe), 1 ether);
    }

    function _run(uint256 sellAmount) internal returns (FliqoSellProbe.Leg memory b, FliqoSellProbe.Leg memory s) {
        (b, s) = probe.run(1, abi.encode(address(pair)), address(token), address(quote), address(0x1), 0.01 ether, sellAmount);
    }

    function test_plainTokenRoundTrip() public {
        (FliqoSellProbe.Leg memory b, FliqoSellProbe.Leg memory s) = _run(0);
        assertTrue(b.ok);
        assertTrue(s.ok);
        assertEq(b.sent, 0.01 ether);
        assertEq(b.received, b.poolOut);
        assertEq(s.sent, b.received);
        assertEq(s.arrived, s.sent);
        assertEq(s.received, s.poolOut);
        // Two 0.3% fees and a tiny price impact: a little under what went in.
        assertLt(s.received, 0.01 ether);
        assertGt(s.received, 0.0099 ether);
        assertGt(b.gas, 0);
        assertGt(s.gas, 0);
    }

    function test_taxedTokenShowsBothTaxes() public {
        token.set(500, false, address(pair));
        (FliqoSellProbe.Leg memory b, FliqoSellProbe.Leg memory s) = _run(0);
        assertTrue(b.ok);
        assertTrue(s.ok);
        assertApproxEqAbs(b.received, (b.poolOut * 9500) / 10_000, 1);
        assertApproxEqAbs(s.arrived, (s.sent * 9500) / 10_000, 1);
    }

    function test_fullTaxOnSellIsNamed() public {
        token.set(10_000, false, address(pair));
        // The buy is taxed fully too: the probe receives nothing, so try the sell with a given balance instead.
        token.mint(address(probe), 1000 ether);
        (, FliqoSellProbe.Leg memory s) = _run(1000 ether);
        assertFalse(s.ok);
        assertEq(s.err, abi.encodeWithSelector(FliqoSellProbe.TaxedTransfer.selector, 1000 ether, 0));
    }

    function test_blockedSellReturnsTheReason() public {
        token.set(0, true, address(pair));
        (FliqoSellProbe.Leg memory b, FliqoSellProbe.Leg memory s) = _run(0);
        assertTrue(b.ok);
        assertFalse(s.ok);
        assertEq(s.err, abi.encodeWithSignature("Error(string)", "Sells are paused"));
    }

    function test_sellOnlyWithAGivenBalance() public {
        token.mint(address(probe), 1000 ether);
        (FliqoSellProbe.Leg memory b, FliqoSellProbe.Leg memory s) = _run(1000 ether);
        assertFalse(b.ok);
        assertEq(b.err.length, 0);
        assertTrue(s.ok);
        assertEq(s.sent, 1000 ether);
        assertGt(s.received, 0);
    }

    function test_missingQuoteBalanceIsReported() public {
        (FliqoSellProbe.Leg memory b,) = probe.run(1, abi.encode(address(pair)), address(token), address(quote), address(0x1), 5 ether, 0);
        assertFalse(b.ok);
        assertEq(b.err, abi.encodeWithSelector(FliqoSellProbe.NoQuoteBalance.selector, 1 ether, 5 ether));
    }

    function test_stepIsSelfOnly() public {
        vm.expectRevert(FliqoSellProbe.OnlySelf.selector);
        probe.step(1, abi.encode(address(pair)), address(quote), address(token), 1);
    }

    function test_callbacksRefuseStrangers() public {
        vm.expectRevert(FliqoSellProbe.NotThePool.selector);
        probe.uniswapV3SwapCallback(1, 0, "");
        vm.expectRevert(FliqoSellProbe.NotThePool.selector);
        probe.unlockCallback("");
    }
}
