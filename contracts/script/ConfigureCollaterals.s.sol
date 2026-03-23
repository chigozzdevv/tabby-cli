// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/oracle/chainlink-price-oracle.sol";
import "../src/policy/market-config.sol";

contract ConfigureCollaterals is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address priceOracleAddr = vm.envAddress("PRICE_ORACLE_ADDRESS");
        address marketConfigAddr = vm.envAddress("MARKET_CONFIG_ADDRESS");

        ChainlinkPriceOracle priceOracle = ChainlinkPriceOracle(priceOracleAddr);
        MarketConfig marketConfig = MarketConfig(marketConfigAddr);

        vm.startBroadcast(pk);

        // WETH — re-enable feed (was accidentally disabled)
        priceOracle.setFeed(
            vm.envAddress("COLLATERAL_0_ASSET"),
            vm.envAddress("COLLATERAL_0_FEED"),
            86400,
            true
        );
        marketConfig.setCollateralConfig(
            vm.envAddress("COLLATERAL_0_ASSET"),
            MarketConfig.CollateralConfig({
                borrowLtvBps: 7000,
                liquidationThresholdBps: 7750,
                liquidationBonusBps: 500,
                supplyCap: 0,
                valueCapUsd: 0,
                enabled: true
            })
        );

        // XAUt0 — Tether Gold
        priceOracle.setFeed(
            vm.envAddress("COLLATERAL_1_ASSET"),
            vm.envAddress("COLLATERAL_1_FEED"),
            86400,
            true
        );
        marketConfig.setCollateralConfig(
            vm.envAddress("COLLATERAL_1_ASSET"),
            MarketConfig.CollateralConfig({
                borrowLtvBps: 5500,
                liquidationThresholdBps: 6500,
                liquidationBonusBps: 500,
                supplyCap: 0,
                valueCapUsd: 0,
                enabled: true
            })
        );

        // wstETH — aliased to WETH for ETH/USD pricing
        priceOracle.setAlias(
            vm.envAddress("COLLATERAL_2_ASSET"),
            vm.envAddress("COLLATERAL_2_PRICE_SOURCE_ASSET")
        );
        priceOracle.setFeed(
            vm.envAddress("COLLATERAL_2_PRICE_SOURCE_ASSET"),
            vm.envAddress("COLLATERAL_2_FEED"),
            86400,
            true
        );
        marketConfig.setCollateralConfig(
            vm.envAddress("COLLATERAL_2_ASSET"),
            MarketConfig.CollateralConfig({
                borrowLtvBps: 7000,
                liquidationThresholdBps: 7750,
                liquidationBonusBps: 500,
                supplyCap: 0,
                valueCapUsd: 0,
                enabled: true
            })
        );

        // WXPL — Wrapped XPL
        priceOracle.setFeed(
            vm.envAddress("COLLATERAL_3_ASSET"),
            vm.envAddress("COLLATERAL_3_FEED"),
            86400,
            true
        );
        marketConfig.setCollateralConfig(
            vm.envAddress("COLLATERAL_3_ASSET"),
            MarketConfig.CollateralConfig({
                borrowLtvBps: 4500,
                liquidationThresholdBps: 5500,
                liquidationBonusBps: 1000,
                supplyCap: 0,
                valueCapUsd: 0,
                enabled: true
            })
        );

        vm.stopBroadcast();
    }
}
