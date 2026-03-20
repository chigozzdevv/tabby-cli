// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {TimelockController} from "../lib/openzeppelin-contracts/contracts/governance/TimelockController.sol";
import {WalletRegistry} from "../src/access/wallet-registry.sol";
import {Treasury} from "../src/core/treasury.sol";
import {DebtPool} from "../src/core/debt-pool.sol";
import {VaultManager} from "../src/core/vault-manager.sol";
import {ChainlinkPriceOracle} from "../src/oracle/chainlink-price-oracle.sol";
import {MarketConfig} from "../src/policy/market-config.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function envAddress(string calldata name) external returns (address);
    function envUint(string calldata name) external returns (uint256);
    function envBool(string calldata name) external returns (bool);
    function envOr(string calldata name, address defaultValue) external returns (address);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256);
    function envOr(string calldata name, bool defaultValue) external returns (bool);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface IRoleManager {
    function ADMIN_ROLE() external view returns (bytes32);
    function grantRole(bytes32 role, address account) external;
    function revokeRole(bytes32 role, address account) external;
}

contract DeployProtocol {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error InvalidCollateralCount();
    error MaxAgeTooLarge();

    event Deployed(
        address walletRegistry,
        address timelock,
        address treasury,
        address debtPool,
        address priceOracle,
        address marketConfig,
        address vaultManager
    );

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);
        address governanceSafe = vm.envAddress("GOVERNANCE_SAFE");
        address emergencySafe = vm.envAddress("EMERGENCY_SAFE");
        address riskSafe = vm.envAddress("RISK_SAFE");
        address treasurySafe = vm.envAddress("TREASURY_SAFE");
        address registryOperatorSafe = vm.envOr("REGISTRY_OPERATOR_SAFE", governanceSafe);
        uint256 timelockMinDelay = vm.envOr("TIMELOCK_MIN_DELAY", uint256(2 days));

        bool useWalletRegistry = vm.envOr("USE_WALLET_REGISTRY", false);

        address debtAsset = vm.envAddress("DEBT_ASSET");
        address debtFeed = vm.envAddress("DEBT_FEED");
        uint256 debtMaxAge = vm.envOr("DEBT_MAX_AGE", uint256(3600));
        address debtPriceSourceAsset = vm.envOr("DEBT_PRICE_SOURCE_ASSET", address(0));

        uint16 treasuryFeeBps = _asUint16(vm.envOr("POOL_TREASURY_FEE_BPS", uint256(500)));

        uint256 collateralCount = vm.envUint("COLLATERAL_COUNT");
        if (collateralCount == 0) revert InvalidCollateralCount();

        vm.startBroadcast(deployerPk);

        WalletRegistry walletRegistry;
        address[] memory proposers = new address[](1);
        proposers[0] = governanceSafe;
        address[] memory executors = new address[](1);
        executors[0] = governanceSafe;
        TimelockController timelock = new TimelockController(timelockMinDelay, proposers, executors, deployer);
        Treasury treasury = new Treasury(treasurySafe);
        ChainlinkPriceOracle priceOracle = new ChainlinkPriceOracle(deployer);
        MarketConfig marketConfig = new MarketConfig(deployer, debtAsset, address(priceOracle));
        DebtPool debtPool = new DebtPool(deployer, debtAsset, address(marketConfig));
        VaultManager vaultManager = new VaultManager(deployer, debtAsset, address(debtPool), address(marketConfig));

        if (useWalletRegistry) {
            walletRegistry = new WalletRegistry(deployer);
            walletRegistry.setWalletStatus(deployer, true);
            address initialAllowedWallet = vm.envOr("INITIAL_ALLOWED_WALLET", address(0));
            if (initialAllowedWallet != address(0)) walletRegistry.setWalletStatus(initialAllowedWallet, true);
            walletRegistry.grantRole(walletRegistry.OPERATOR_ROLE(), registryOperatorSafe);
            walletRegistry.revokeRole(walletRegistry.OPERATOR_ROLE(), deployer);

            debtPool.setWalletRegistry(address(walletRegistry));
            vaultManager.setWalletRegistry(address(walletRegistry));
        }

        debtPool.setFeeConfig(treasuryFeeBps);
        debtPool.setFeeRecipient(vm.envOr("POOL_TREASURY_FEE_RECIPIENT", address(treasury)));

        marketConfig.setRiskParams(
            _asUint16(vm.envOr("CLOSE_FACTOR_BPS", uint256(5000))),
            vm.envOr("MIN_BORROW_AMOUNT", uint256(0)),
            vm.envOr("MIN_DEBT_AMOUNT", uint256(0))
        );
        marketConfig.setDebtCap(vm.envOr("DEBT_CAP", uint256(0)));
        marketConfig.setPauseFlags(
            vm.envOr("LP_DEPOSIT_PAUSED", false),
            vm.envOr("LP_WITHDRAW_PAUSED", false),
            vm.envOr("COLLATERAL_DEPOSIT_PAUSED", false),
            vm.envOr("COLLATERAL_WITHDRAW_PAUSED", false),
            vm.envOr("BORROW_PAUSED", false),
            vm.envOr("LIQUIDATION_PAUSED", false)
        );
        marketConfig.setRateModel(
            MarketConfig.RateModel({
                baseRateBps: _asUint16(vm.envOr("RATE_BASE_BPS", uint256(300))),
                kinkUtilizationBps: _asUint16(vm.envOr("RATE_KINK_BPS", uint256(8000))),
                slope1Bps: _asUint16(vm.envOr("RATE_SLOPE1_BPS", uint256(700))),
                slope2Bps: _asUint16(vm.envOr("RATE_SLOPE2_BPS", uint256(2500))),
                minRateBps: _asUint16(vm.envOr("RATE_MIN_BPS", uint256(100))),
                maxRateBps: _asUint16(vm.envOr("RATE_MAX_BPS", uint256(6000)))
            })
        );

        address debtFeedAsset = debtAsset;
        if (debtPriceSourceAsset != address(0) && debtPriceSourceAsset != debtAsset) {
            priceOracle.setAlias(debtAsset, debtPriceSourceAsset);
            debtFeedAsset = debtPriceSourceAsset;
        }
        priceOracle.setFeed(debtFeedAsset, debtFeed, _asUint48(debtMaxAge), true);

        debtPool.grantRole(debtPool.BORROW_ROLE(), address(vaultManager));
        debtPool.grantRole(debtPool.REPAY_ROLE(), address(vaultManager));
        debtPool.grantRole(debtPool.RISK_ROLE(), address(vaultManager));
        vaultManager.grantRole(vaultManager.RISK_ROLE(), riskSafe);
        marketConfig.grantRole(marketConfig.GUARDIAN_ROLE(), emergencySafe);

        for (uint256 i = 0; i < collateralCount; ++i) {
            string memory idx = _toString(i);
            address collateralAsset = vm.envAddress(_indexedKey("COLLATERAL_", idx, "_ASSET"));
            address collateralFeed = vm.envAddress(_indexedKey("COLLATERAL_", idx, "_FEED"));
            address collateralPriceSourceAsset = vm.envOr(_indexedKey("COLLATERAL_", idx, "_PRICE_SOURCE_ASSET"), address(0));

            address feedAsset = collateralAsset;
            if (collateralPriceSourceAsset != address(0) && collateralPriceSourceAsset != collateralAsset) {
                priceOracle.setAlias(collateralAsset, collateralPriceSourceAsset);
                feedAsset = collateralPriceSourceAsset;
            }
            priceOracle.setFeed(
                feedAsset,
                collateralFeed,
                _asUint48(vm.envOr(_indexedKey("COLLATERAL_", idx, "_MAX_AGE"), uint256(3600))),
                true
            );

            marketConfig.setCollateralConfig(
                collateralAsset,
                MarketConfig.CollateralConfig({
                    borrowLtvBps: _asUint16(vm.envUint(_indexedKey("COLLATERAL_", idx, "_BORROW_LTV_BPS"))),
                    liquidationThresholdBps: _asUint16(vm.envUint(_indexedKey("COLLATERAL_", idx, "_LIQ_THRESHOLD_BPS"))),
                    liquidationBonusBps: _asUint16(vm.envOr(_indexedKey("COLLATERAL_", idx, "_LIQ_BONUS_BPS"), uint256(500))),
                    supplyCap: vm.envOr(_indexedKey("COLLATERAL_", idx, "_SUPPLY_CAP"), uint256(0)),
                    valueCapUsd: vm.envOr(_indexedKey("COLLATERAL_", idx, "_VALUE_CAP_USD"), uint256(0)),
                    enabled: vm.envOr(_indexedKey("COLLATERAL_", idx, "_ENABLED"), true)
                })
            );
        }

        if (address(walletRegistry) != address(0)) {
            _handoffAdmin(address(walletRegistry), deployer, address(timelock));
        }
        _handoffAdmin(address(debtPool), deployer, address(timelock));
        _handoffAdmin(address(priceOracle), deployer, address(timelock));
        _handoffAdmin(address(marketConfig), deployer, address(timelock));
        _handoffAdmin(address(vaultManager), deployer, address(timelock));
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), deployer);

        vm.stopBroadcast();

        emit Deployed(
            address(walletRegistry),
            address(timelock),
            address(treasury),
            address(debtPool),
            address(priceOracle),
            address(marketConfig),
            address(vaultManager)
        );
    }

    function _handoffAdmin(address target, address deployer, address governance) internal {
        if (governance == address(0) || governance == deployer) return;
        IRoleManager(target).grantRole(IRoleManager(target).ADMIN_ROLE(), governance);
        IRoleManager(target).revokeRole(IRoleManager(target).ADMIN_ROLE(), deployer);
    }

    function _asUint16(uint256 value) internal pure returns (uint16) {
        require(value <= type(uint16).max, "uint16");
        // casting to uint16 is safe because the bound above enforces the target range.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint16(value);
    }

    function _asUint48(uint256 value) internal pure returns (uint48) {
        if (value > type(uint48).max) revert MaxAgeTooLarge();
        // casting to uint48 is safe because the bound above enforces the target range.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint48(value);
    }

    function _indexedKey(string memory prefix, string memory idx, string memory suffix) internal pure returns (string memory) {
        return string.concat(prefix, idx, suffix);
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";

        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }

        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            // casting to uint8 is safe because each digit is constrained to the ASCII range 48-57.
            // forge-lint: disable-next-line(unsafe-typecast)
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
