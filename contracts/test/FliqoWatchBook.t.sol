// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FliqoWatchBook} from "../src/FliqoWatchBook.sol";

/// Answers arbBlockNumber() like the ArbSys precompile on Robinhood Chain.
contract FakeArbSys {
    uint256 public n = 123_456_789;

    function set(uint256 v) external {
        n = v;
    }

    fallback(bytes calldata) external returns (bytes memory) {
        return abi.encode(n);
    }
}

contract FliqoWatchBookTest is Test {
    FliqoWatchBook book;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    event WatchlistSaved(address indexed owner, uint32 indexed version, uint256 count, bytes32 settingsHash, uint64 savedBlock, address[] tokens, bytes settings);
    event WatchlistCleared(address indexed owner, uint32 indexed version, uint64 savedBlock);

    function setUp() public {
        book = new FliqoWatchBook();
        vm.roll(1_000);
        vm.warp(1_800_000_000);
    }

    function _list(uint256 n, uint256 seed) internal pure returns (address[] memory a) {
        a = new address[](n);
        for (uint256 i = 0; i < n; ++i) a[i] = address(uint160(uint256(keccak256(abi.encode(seed, i))) | 1));
    }

    function test_firstSaveIsVersionOne() public {
        address[] memory t = _list(3, 1);
        bytes memory s = bytes('{"v":1}');
        vm.expectEmit(true, true, false, true, address(book));
        emit WatchlistSaved(alice, 1, 3, keccak256(s), 1_000, t, s);
        vm.prank(alice);
        uint32 v = book.save(0, t, s);
        assertEq(v, 1);
        (uint32 version, uint64 at, uint64 blk, address[] memory tokens, bytes memory settings) = book.watchlistOf(alice);
        assertEq(version, 1);
        assertEq(at, 1_800_000_000);
        assertEq(blk, 1_000);
        assertEq(tokens.length, 3);
        assertEq(tokens[2], t[2]);
        assertEq(settings, s);
        assertEq(book.versionOf(alice), 1);
        assertEq(book.countOf(alice), 3);
        assertEq(book.totalSaves(), 1);
        assertEq(book.ownerCount(), 1);
    }

    function test_neverSavedReadsEmpty() public view {
        (uint32 version, uint64 at, uint64 blk, address[] memory tokens, bytes memory settings) = book.watchlistOf(bob);
        assertEq(version, 0);
        assertEq(at, 0);
        assertEq(blk, 0);
        assertEq(tokens.length, 0);
        assertEq(settings.length, 0);
    }

    function test_secondSaveReplacesAndBumps() public {
        vm.startPrank(alice);
        book.save(0, _list(5, 1), "a");
        book.save(1, _list(2, 2), "bb");
        vm.stopPrank();
        (uint32 version,,, address[] memory tokens, bytes memory settings) = book.watchlistOf(alice);
        assertEq(version, 2);
        assertEq(tokens.length, 2);
        assertEq(tokens[0], _list(2, 2)[0]);
        assertEq(settings, bytes("bb"));
        assertEq(book.ownerCount(), 1);
        assertEq(book.totalSaves(), 2);
    }

    function test_staleVersionReverts() public {
        vm.startPrank(alice);
        book.save(0, _list(1, 1), "");
        vm.expectRevert(abi.encodeWithSelector(FliqoWatchBook.StaleVersion.selector, uint32(0), uint32(1)));
        book.save(0, _list(1, 2), "");
        vm.expectRevert(abi.encodeWithSelector(FliqoWatchBook.StaleVersion.selector, uint32(5), uint32(1)));
        book.save(5, _list(1, 2), "");
        vm.expectRevert(abi.encodeWithSelector(FliqoWatchBook.StaleVersion.selector, uint32(0), uint32(1)));
        book.clear(0);
        vm.stopPrank();
    }

    function test_walletsAreIndependent() public {
        vm.prank(alice);
        book.save(0, _list(2, 1), "a");
        vm.prank(bob);
        book.save(0, _list(4, 9), "b");
        assertEq(book.countOf(alice), 2);
        assertEq(book.countOf(bob), 4);
        assertEq(book.versionOf(bob), 1);
        address[] memory page = book.ownersFrom(0, 10);
        assertEq(page.length, 2);
        assertEq(page[0], alice);
        assertEq(page[1], bob);
    }

    function test_fiftyTokensAccepted_fiftyOneRefused() public {
        vm.startPrank(alice);
        book.save(0, _list(50, 3), "");
        assertEq(book.countOf(alice), 50);
        vm.expectRevert(abi.encodeWithSelector(FliqoWatchBook.TooManyTokens.selector, uint256(51)));
        book.save(1, _list(51, 3), "");
        vm.stopPrank();
    }

    function test_settingsSizeBound() public {
        vm.startPrank(alice);
        book.save(0, _list(1, 1), new bytes(1536));
        vm.expectRevert(abi.encodeWithSelector(FliqoWatchBook.SettingsTooLarge.selector, uint256(1537)));
        book.save(1, _list(1, 1), new bytes(1537));
        vm.stopPrank();
    }

    function test_zeroTokenRefused() public {
        address[] memory t = _list(3, 1);
        t[1] = address(0);
        vm.expectRevert(abi.encodeWithSelector(FliqoWatchBook.ZeroToken.selector, uint256(1)));
        vm.prank(alice);
        book.save(0, t, "");
    }

    function test_repeatedTokenRefused() public {
        address[] memory t = _list(4, 1);
        t[3] = t[0];
        vm.expectRevert(abi.encodeWithSelector(FliqoWatchBook.RepeatedToken.selector, uint256(3)));
        vm.prank(alice);
        book.save(0, t, "");
    }

    function test_emptyListAllowed() public {
        vm.prank(alice);
        book.save(0, new address[](0), "x");
        assertEq(book.countOf(alice), 0);
        assertEq(book.versionOf(alice), 1);
    }

    function test_clearEmptiesAndBumps() public {
        vm.startPrank(alice);
        book.save(0, _list(3, 1), "abc");
        vm.expectEmit(true, true, false, true, address(book));
        emit WatchlistCleared(alice, 2, 1_000);
        uint32 v = book.clear(1);
        vm.stopPrank();
        assertEq(v, 2);
        (uint32 version,,, address[] memory tokens, bytes memory settings) = book.watchlistOf(alice);
        assertEq(version, 2);
        assertEq(tokens.length, 0);
        assertEq(settings.length, 0);
        assertEq(book.totalSaves(), 2);
    }

    function test_clearOnFreshWallet() public {
        vm.prank(bob);
        assertEq(book.clear(0), 1);
        assertEq(book.ownerCount(), 1);
    }

    function test_pagination() public {
        for (uint256 i = 0; i < 7; ++i) {
            vm.prank(address(uint160(0x1000 + i)));
            book.save(0, _list(1, i), "");
        }
        assertEq(book.ownersFrom(5, 10).length, 2);
        assertEq(book.ownersFrom(7, 10).length, 0);
        assertEq(book.ownersFrom(100, 10).length, 0);
        assertEq(book.ownersFrom(2, 3)[0], address(uint160(0x1002)));
        vm.expectRevert(abi.encodeWithSelector(FliqoWatchBook.PageTooLarge.selector, uint256(101)));
        book.ownersFrom(0, 101);
    }

    function test_rejectsEth() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(book).call{value: 1}("");
        assertFalse(ok);
        assertEq(address(book).balance, 0);
    }

    function test_chainBlockUsesArbSysWhenPresent() public {
        FakeArbSys fake = new FakeArbSys();
        vm.etch(address(0x64), address(fake).code);
        vm.store(address(0x64), bytes32(0), bytes32(uint256(222_000_111)));
        assertEq(book.chainBlock(), 222_000_111);
        vm.prank(alice);
        book.save(0, _list(1, 1), "");
        (,, uint64 blk,,) = book.watchlistOf(alice);
        assertEq(blk, 222_000_111);
    }

    function test_chainBlockFallsBackWhenArbSysReturnsZero() public {
        FakeArbSys fake = new FakeArbSys();
        vm.etch(address(0x64), address(fake).code);
        vm.store(address(0x64), bytes32(0), bytes32(uint256(0)));
        assertEq(book.chainBlock(), 1_000);
    }

    function test_chainBlockFallsBackWhenArbSysReverts() public {
        vm.etch(address(0x64), hex"60006000fd");
        assertEq(book.chainBlock(), 1_000);
    }

    function testFuzz_saveRoundTrip(uint8 n, bytes calldata settings, uint256 seed) public {
        n = uint8(bound(n, 0, 50));
        vm.assume(settings.length <= 1536);
        address[] memory t = _list(n, seed);
        vm.prank(alice);
        book.save(0, t, settings);
        (uint32 version,,, address[] memory tokens, bytes memory s) = book.watchlistOf(alice);
        assertEq(version, 1);
        assertEq(tokens.length, n);
        for (uint256 i = 0; i < n; ++i) assertEq(tokens[i], t[i]);
        assertEq(keccak256(s), keccak256(settings));
    }

    function testFuzz_wrongVersionAlwaysReverts(uint32 expected, uint8 saves) public {
        saves = uint8(bound(saves, 0, 5));
        vm.startPrank(alice);
        for (uint32 i = 0; i < saves; ++i) book.save(i, _list(1, i), "");
        vm.assume(expected != saves);
        vm.expectRevert(abi.encodeWithSelector(FliqoWatchBook.StaleVersion.selector, expected, uint32(saves)));
        book.save(expected, _list(1, 99), "");
        vm.stopPrank();
    }

    function testFuzz_tooManyTokens(uint8 n) public {
        uint256 m = bound(n, 51, 200);
        vm.expectRevert(abi.encodeWithSelector(FliqoWatchBook.TooManyTokens.selector, m));
        vm.prank(alice);
        book.save(0, _list(m, 7), "");
    }
}
