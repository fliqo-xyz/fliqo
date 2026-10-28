// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FliqoWatchBook} from "../src/FliqoWatchBook.sol";

/// Drives random saves and clears from a few wallets and mirrors the expected state.
contract WatchHandler is Test {
    FliqoWatchBook public book;
    address[] public actors;
    mapping(address => uint32) public expectedVersion;
    mapping(address => uint256) public expectedCount;
    uint256 public accepted;

    constructor(FliqoWatchBook b) {
        book = b;
        for (uint256 i = 0; i < 4; ++i) actors.push(address(uint160(0xA000 + i)));
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function save(uint256 who, uint8 n, uint256 seed, bool stale) external {
        address a = actors[who % actors.length];
        n = uint8(bound(n, 0, 60));
        address[] memory t = new address[](n);
        for (uint256 i = 0; i < n; ++i) t[i] = address(uint160(uint256(keccak256(abi.encode(seed, i))) | 1));
        uint32 v = stale ? expectedVersion[a] + 1 : expectedVersion[a];
        vm.prank(a);
        try book.save(v, t, abi.encode(seed)) returns (uint32 nv) {
            expectedVersion[a] = nv;
            expectedCount[a] = n;
            accepted++;
        } catch {}
    }

    function clear(uint256 who) external {
        address a = actors[who % actors.length];
        vm.prank(a);
        book.clear(expectedVersion[a]);
        expectedVersion[a] += 1;
        expectedCount[a] = 0;
        accepted++;
    }
}

contract FliqoWatchBookInvariantTest is Test {
    FliqoWatchBook book;
    WatchHandler handler;

    function setUp() public {
        book = new FliqoWatchBook();
        handler = new WatchHandler(book);
        targetContract(address(handler));
    }

    function invariant_versionsAndCountsMatch() public view {
        for (uint256 i = 0; i < handler.actorCount(); ++i) {
            address a = handler.actors(i);
            assertEq(book.versionOf(a), handler.expectedVersion(a));
            assertEq(book.countOf(a), handler.expectedCount(a));
            assertLe(book.countOf(a), book.MAX_TOKENS());
        }
    }

    function invariant_totalSavesCountsAcceptedCalls() public view {
        assertEq(book.totalSaves(), handler.accepted());
        assertLe(book.ownerCount(), handler.actorCount());
    }

    function invariant_neverHoldsEth() public view {
        assertEq(address(book).balance, 0);
    }
}
