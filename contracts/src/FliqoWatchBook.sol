// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FliqoWatchBook
/// @notice Public watchlist book for Fliqo on Robinhood Chain. A wallet saves its watchlist (up to 50 token
///         addresses) together with its alert thresholds as one versioned record, so the same list opens on any
///         device that reads this contract. Each save bumps the wallet's version; a save names the version it was
///         based on, so a device holding an older copy cannot silently overwrite a newer one.
///         The thresholds are an opaque byte string (at most 1536 bytes) written by the Fliqo site; the contract
///         only bounds its size. Everything stored here is public: anyone can read any wallet's list.
/// @dev No owner, no admin, no fee, no pause, no upgrade path, no constructor arguments, no token. The contract never
///      holds funds: no function is payable and there is no receive or fallback, so ETH transfers revert.
///      On Arbitrum-style chains `block.number` reports the parent chain's block, so the chain's own block is read
///      from the ArbSys precompile when it answers, and from `block.number` everywhere else (local tests).
contract FliqoWatchBook {
    /// @notice Most token addresses one watchlist holds.
    uint256 public constant MAX_TOKENS = 50;
    /// @notice Largest thresholds payload, in bytes.
    uint256 public constant MAX_SETTINGS = 1536;
    /// @notice Most entries a paginated read returns at once.
    uint256 public constant MAX_PAGE = 100;

    /// @dev ArbSys precompile. `arbBlockNumber()` returns the chain's own block number.
    address private constant ARB_SYS = address(0x64);
    bytes4 private constant ARB_BLOCK_NUMBER = 0xa3b1b31d;
    /// @dev Gas forwarded to ArbSys; the cap keeps a chain where 0x64 holds failing code from burning all gas.
    uint256 private constant ARB_SYS_GAS = 30_000;

    struct Record {
        uint32 version;
        uint64 savedAt;
        uint64 savedBlock;
        address[] tokens;
        bytes settings;
    }

    mapping(address owner => Record) private _records;
    address[] private _owners;
    mapping(address owner => bool) private _known;

    /// @notice Saves accepted, counting clears.
    uint256 public totalSaves;

    /// @notice A wallet saved a new version of its watchlist. `settingsHash` is keccak256(settings).
    event WatchlistSaved(
        address indexed owner,
        uint32 indexed version,
        uint256 count,
        bytes32 settingsHash,
        uint64 savedBlock,
        address[] tokens,
        bytes settings
    );

    /// @notice A wallet emptied its watchlist (also a new version).
    event WatchlistCleared(address indexed owner, uint32 indexed version, uint64 savedBlock);

    error StaleVersion(uint32 expected, uint32 current);
    error TooManyTokens(uint256 count);
    error SettingsTooLarge(uint256 length);
    error ZeroToken(uint256 index);
    error RepeatedToken(uint256 index);
    error PageTooLarge(uint256 limit);

    /// @notice Saves the caller's watchlist as version `expectedVersion + 1`.
    /// @param expectedVersion The version this list was based on (0 for a wallet that never saved).
    /// @param tokens Token addresses, at most 50, no zero address, no address twice.
    /// @param settings Alert thresholds as written by the site, at most 1536 bytes (may be empty).
    /// @return version The new version number.
    function save(uint32 expectedVersion, address[] calldata tokens, bytes calldata settings) external returns (uint32 version) {
        Record storage r = _records[msg.sender];
        if (r.version != expectedVersion) revert StaleVersion(expectedVersion, r.version);
        uint256 n = tokens.length;
        if (n > MAX_TOKENS) revert TooManyTokens(n);
        if (settings.length > MAX_SETTINGS) revert SettingsTooLarge(settings.length);
        for (uint256 i = 0; i < n; ++i) {
            address t = tokens[i];
            if (t == address(0)) revert ZeroToken(i);
            for (uint256 j = 0; j < i; ++j) {
                if (tokens[j] == t) revert RepeatedToken(i);
            }
        }
        version = expectedVersion + 1;
        uint64 blk = _chainBlock();
        r.version = version;
        r.savedAt = uint64(block.timestamp);
        r.savedBlock = blk;
        r.tokens = tokens;
        r.settings = settings;
        _remember(msg.sender);
        unchecked {
            ++totalSaves;
        }
        emit WatchlistSaved(msg.sender, version, n, keccak256(settings), blk, tokens, settings);
    }

    /// @notice Empties the caller's watchlist and thresholds as version `expectedVersion + 1`.
    function clear(uint32 expectedVersion) external returns (uint32 version) {
        Record storage r = _records[msg.sender];
        if (r.version != expectedVersion) revert StaleVersion(expectedVersion, r.version);
        version = expectedVersion + 1;
        uint64 blk = _chainBlock();
        r.version = version;
        r.savedAt = uint64(block.timestamp);
        r.savedBlock = blk;
        delete r.tokens;
        delete r.settings;
        _remember(msg.sender);
        unchecked {
            ++totalSaves;
        }
        emit WatchlistCleared(msg.sender, version, blk);
    }

    /// @notice The current record of `owner` (version 0 and empty lists for a wallet that never saved).
    function watchlistOf(address owner)
        external
        view
        returns (uint32 version, uint64 savedAt, uint64 savedBlock, address[] memory tokens, bytes memory settings)
    {
        Record storage r = _records[owner];
        return (r.version, r.savedAt, r.savedBlock, r.tokens, r.settings);
    }

    /// @notice Version of `owner`'s record (0 = never saved).
    function versionOf(address owner) external view returns (uint32) {
        return _records[owner].version;
    }

    /// @notice Number of tokens in `owner`'s current list.
    function countOf(address owner) external view returns (uint256) {
        return _records[owner].tokens.length;
    }

    /// @notice Wallets that ever saved, counting each once.
    function ownerCount() external view returns (uint256) {
        return _owners.length;
    }

    /// @notice Wallets that ever saved, in first-save order, `limit` at most 100.
    function ownersFrom(uint256 start, uint256 limit) external view returns (address[] memory page) {
        if (limit > MAX_PAGE) revert PageTooLarge(limit);
        uint256 total = _owners.length;
        if (start >= total) return new address[](0);
        uint256 end = start + limit > total ? total : start + limit;
        page = new address[](end - start);
        for (uint256 i = start; i < end; ++i) page[i - start] = _owners[i];
    }

    /// @notice The chain's own block number (ArbSys on Robinhood Chain, `block.number` elsewhere).
    function chainBlock() external view returns (uint64) {
        return _chainBlock();
    }

    function _remember(address owner) private {
        if (!_known[owner]) {
            _known[owner] = true;
            _owners.push(owner);
        }
    }

    function _chainBlock() private view returns (uint64) {
        (bool ok, bytes memory out) = ARB_SYS.staticcall{gas: ARB_SYS_GAS}(abi.encodeWithSelector(ARB_BLOCK_NUMBER));
        if (ok && out.length == 32) {
            uint256 b = abi.decode(out, (uint256));
            if (b > 0 && b <= type(uint64).max) return uint64(b);
        }
        return uint64(block.number);
    }
}
