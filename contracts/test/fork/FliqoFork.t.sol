// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FliqoWatchBook} from "../../src/FliqoWatchBook.sol";

/// Fork tests against Robinhood Chain (chain 4663). Run with:
///   forge test --match-path 'test/fork/*' --fork-url https://robinhood-rpc.publicnode.com
contract FliqoForkTest is Test {
    // WETH and USDG on Robinhood Chain, as listed in src/config/brand.ts.
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    function test_chainIsRobinhood() public view {
        assertEq(block.chainid, 4663);
    }

    function test_saveRealTokensAndGas() public {
        // Forge does not emulate ArbSys on a fork: the book falls back to the forked block number, which is the
        // chain's own block (about a hundred million), not the parent-chain block.
        FliqoWatchBook book = new FliqoWatchBook();
        assertEq(book.chainBlock(), uint64(block.number));
        assertGt(block.number, 90_000_000);
        address[] memory t = new address[](2);
        t[0] = WETH;
        t[1] = USDG;
        assertGt(WETH.code.length, 0);
        assertGt(USDG.code.length, 0);
        vm.prank(address(0xA11CE));
        uint256 g0 = gasleft();
        book.save(0, t, bytes('{"v":1,"r":[[0,0,0,10,0]]}'));
        uint256 used = g0 - gasleft();
        emit log_named_uint("save 2 tokens gas (in-call)", used);
        assertLt(used, 400_000);
        assertEq(book.countOf(address(0xA11CE)), 2);
    }

    function test_fullListGas() public {
        FliqoWatchBook book = new FliqoWatchBook();
        address[] memory t = new address[](50);
        for (uint256 i = 0; i < 50; ++i) t[i] = address(uint160(0x1000 + i));
        bytes memory s = new bytes(1536);
        vm.prank(address(0xB0B));
        uint256 g0 = gasleft();
        book.save(0, t, s);
        uint256 used = g0 - gasleft();
        emit log_named_uint("save 50 tokens + 1536 bytes gas (in-call)", used);
        assertLt(used, 3_500_000);
    }
}
