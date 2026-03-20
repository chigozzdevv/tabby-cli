// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "../lib/openzeppelin-contracts/lib/forge-std/src/Test.sol";
import {ChainlinkPriceOracle} from "../src/oracle/chainlink-price-oracle.sol";

interface IERC20MetadataLike {
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

interface IAggregatorV3Like {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

contract PlasmaForkTest is Test {
    string internal constant PLASMA_RPC_URL = "https://rpc.plasma.to";

    address internal constant PLASMA_USDT0 = 0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb;
    address internal constant PLASMA_WETH = 0x9895D81bB462A195b4922ED7De0e3ACD007c32CB;
    address internal constant PLASMA_XAUT0 = 0x1B64B9025EEbb9A6239575dF9Ea4b9Ac46D4d193;

    address internal constant PLASMA_USDT0_USD_FEED = 0x3205B49b3C8c5D593589e1e70567993f72C5F845;
    address internal constant PLASMA_ETH_USD_FEED = 0x43A7dd2125266c5c4c26EB86cd61241132426Fe7;
    address internal constant PLASMA_BTC_USD_FEED = 0x3Bc5434dd1Fc6a1B68625e0269B9818cDd9E21B5;
    address internal constant PLASMA_XAUT_USD_FEED = 0x354Df1ca4AE838A45405B3486ED0161AA7f01191;

    function setUp() public {
        vm.createSelectFork(PLASMA_RPC_URL);
    }

    function test_plasmaFork_verifiedCollateralAndDebtTokensHaveExpectedMetadata() external view {
        assertGt(PLASMA_USDT0.code.length, 0, "USDT0 should exist on Plasma");
        assertGt(PLASMA_WETH.code.length, 0, "WETH should exist on Plasma");
        assertGt(PLASMA_XAUT0.code.length, 0, "XAUt0 should exist on Plasma");

        assertEq(IERC20MetadataLike(PLASMA_USDT0).symbol(), "USDT0", "unexpected USDT0 symbol");
        assertEq(IERC20MetadataLike(PLASMA_USDT0).decimals(), 6, "unexpected USDT0 decimals");

        assertEq(IERC20MetadataLike(PLASMA_WETH).symbol(), "WETH", "unexpected WETH symbol");
        assertEq(IERC20MetadataLike(PLASMA_WETH).decimals(), 18, "unexpected WETH decimals");

        assertEq(IERC20MetadataLike(PLASMA_XAUT0).symbol(), "XAUt0", "unexpected XAUt0 symbol");
        assertEq(IERC20MetadataLike(PLASMA_XAUT0).decimals(), 6, "unexpected XAUt0 decimals");
    }

    function test_plasmaFork_chainlinkFeedsAreLive() external view {
        _assertLiveFeed(PLASMA_USDT0_USD_FEED);
        _assertLiveFeed(PLASMA_ETH_USD_FEED);
        _assertLiveFeed(PLASMA_BTC_USD_FEED);
        _assertLiveFeed(PLASMA_XAUT_USD_FEED);
    }

    function test_plasmaFork_protocolOracleNormalizesVerifiedAssets() external {
        ChainlinkPriceOracle oracle = new ChainlinkPriceOracle(address(this));
        oracle.setFeed(PLASMA_USDT0, PLASMA_USDT0_USD_FEED, uint48(1 days), true);
        oracle.setFeed(PLASMA_WETH, PLASMA_ETH_USD_FEED, uint48(1 days), true);
        oracle.setFeed(PLASMA_XAUT0, PLASMA_XAUT_USD_FEED, uint48(1 days), true);

        uint256 usdt0Price = oracle.getPrice(PLASMA_USDT0);
        uint256 wethPrice = oracle.getPrice(PLASMA_WETH);
        uint256 xaut0Price = oracle.getPrice(PLASMA_XAUT0);

        assertGt(usdt0Price, 9e17, "USDT0 price should remain near peg");
        assertLt(usdt0Price, 11e17, "USDT0 price should remain near peg");
        assertGt(wethPrice, 1_000e18, "ETH price should be positive and realistic");
        assertGt(xaut0Price, 1_000e18, "XAUt0 price should be positive and realistic");
    }

    function test_plasmaFork_optionalBtcCollateralCanBeBoundToLiveBtcFeed() external {
        address btcAsset = vm.envOr("PLASMA_BTC_COLLATERAL_ASSET", address(0));
        if (btcAsset == address(0)) return;

        assertGt(btcAsset.code.length, 0, "configured BTC collateral must exist");

        ChainlinkPriceOracle oracle = new ChainlinkPriceOracle(address(this));
        oracle.setFeed(btcAsset, PLASMA_BTC_USD_FEED, uint48(1 days), true);

        uint256 btcPrice = oracle.getPrice(btcAsset);
        assertGt(btcPrice, 10_000e18, "BTC price should be positive and realistic");
    }

    function _assertLiveFeed(address feed) internal view {
        assertGt(feed.code.length, 0, "feed must exist");

        IAggregatorV3Like aggregator = IAggregatorV3Like(feed);
        (, int256 answer, , uint256 updatedAt, ) = aggregator.latestRoundData();

        assertGt(uint256(answer), 0, "feed answer must be positive");
        assertTrue(updatedAt != 0, "feed update timestamp must be present");
        assertLe(block.timestamp - updatedAt, 1 days, "feed must be fresh enough for fork validation");

        uint8 decimals = aggregator.decimals();
        assertTrue(decimals <= 18, "unexpected feed decimals");
    }
}
