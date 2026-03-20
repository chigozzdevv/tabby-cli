// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {RoleManager} from "../access/role-manager.sol";

contract MarketConfig is RoleManager {
    error InvalidAddress();
    error InvalidBps();
    error InvalidCap();
    error InvalidPauseAction();
    error InvalidRateModel();

    struct CollateralConfig {
        uint16 borrowLtvBps;
        uint16 liquidationThresholdBps;
        uint16 liquidationBonusBps;
        uint256 supplyCap;
        uint256 valueCapUsd;
        bool enabled;
    }

    struct RateModel {
        uint16 baseRateBps;
        uint16 kinkUtilizationBps;
        uint16 slope1Bps;
        uint16 slope2Bps;
        uint16 minRateBps;
        uint16 maxRateBps;
    }

    address public immutable debtAsset;
    address public priceOracle;

    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    uint16 public closeFactorBps;
    uint256 public minBorrowAmount;
    uint256 public minDebtAmount;
    uint256 public debtCap;

    bool public lpDepositPaused;
    bool public lpWithdrawPaused;
    bool public collateralDepositPaused;
    bool public collateralWithdrawPaused;
    bool public borrowPaused;
    bool public liquidationPaused;

    RateModel public rateModel;

    mapping(address => CollateralConfig) public collateralConfigs;
    mapping(address => bool) public isListedCollateral;
    address[] private _collateralAssets;

    event PriceOracleUpdated(address indexed priceOracle);
    event RiskParamsUpdated(uint16 closeFactorBps, uint256 minBorrowAmount, uint256 minDebtAmount);
    event DebtCapUpdated(uint256 debtCap);
    event PauseFlagsUpdated(
        bool lpDepositPaused,
        bool lpWithdrawPaused,
        bool collateralDepositPaused,
        bool collateralWithdrawPaused,
        bool borrowPaused,
        bool liquidationPaused
    );
    event RateModelUpdated(
        uint16 baseRateBps,
        uint16 kinkUtilizationBps,
        uint16 slope1Bps,
        uint16 slope2Bps,
        uint16 minRateBps,
        uint16 maxRateBps
    );
    event CollateralConfigured(
        address indexed asset,
        uint16 borrowLtvBps,
        uint16 liquidationThresholdBps,
        uint16 liquidationBonusBps,
        uint256 supplyCap,
        uint256 valueCapUsd,
        bool enabled
    );

    constructor(address admin, address debtAsset_, address priceOracle_) RoleManager(admin) {
        if (debtAsset_ == address(0) || priceOracle_ == address(0)) revert InvalidAddress();

        debtAsset = debtAsset_;
        priceOracle = priceOracle_;
        closeFactorBps = 5000;

        rateModel = RateModel({
            baseRateBps: 300,
            kinkUtilizationBps: 8000,
            slope1Bps: 700,
            slope2Bps: 2500,
            minRateBps: 100,
            maxRateBps: 6000
        });

        emit PriceOracleUpdated(priceOracle_);
        emit RiskParamsUpdated(closeFactorBps, 0, 0);
        emit DebtCapUpdated(0);
        emit PauseFlagsUpdated(false, false, false, false, false, false);
        emit RateModelUpdated(300, 8000, 700, 2500, 100, 6000);
    }

    function setPriceOracle(address priceOracle_) external onlyRole(ADMIN_ROLE) {
        if (priceOracle_ == address(0)) revert InvalidAddress();
        priceOracle = priceOracle_;
        emit PriceOracleUpdated(priceOracle_);
    }

    function setRiskParams(uint16 closeFactorBps_, uint256 minBorrowAmount_, uint256 minDebtAmount_)
        external
        onlyRole(ADMIN_ROLE)
    {
        if (closeFactorBps_ == 0 || closeFactorBps_ > 10000) revert InvalidBps();
        closeFactorBps = closeFactorBps_;
        minBorrowAmount = minBorrowAmount_;
        minDebtAmount = minDebtAmount_;
        emit RiskParamsUpdated(closeFactorBps_, minBorrowAmount_, minDebtAmount_);
    }

    function setDebtCap(uint256 debtCap_) external onlyRole(ADMIN_ROLE) {
        if (debtCap_ != 0 && debtCap_ < minDebtAmount) revert InvalidCap();
        debtCap = debtCap_;
        emit DebtCapUpdated(debtCap_);
    }

    function setPauseFlags(
        bool lpDepositPaused_,
        bool lpWithdrawPaused_,
        bool collateralDepositPaused_,
        bool collateralWithdrawPaused_,
        bool borrowPaused_,
        bool liquidationPaused_
    ) external onlyRole(ADMIN_ROLE) {
        lpDepositPaused = lpDepositPaused_;
        lpWithdrawPaused = lpWithdrawPaused_;
        collateralDepositPaused = collateralDepositPaused_;
        collateralWithdrawPaused = collateralWithdrawPaused_;
        borrowPaused = borrowPaused_;
        liquidationPaused = liquidationPaused_;

        emit PauseFlagsUpdated(
            lpDepositPaused_,
            lpWithdrawPaused_,
            collateralDepositPaused_,
            collateralWithdrawPaused_,
            borrowPaused_,
            liquidationPaused_
        );
    }

    function guardianPauseFlags(
        bool lpDepositPaused_,
        bool lpWithdrawPaused_,
        bool collateralDepositPaused_,
        bool collateralWithdrawPaused_,
        bool borrowPaused_,
        bool liquidationPaused_
    ) external onlyRole(GUARDIAN_ROLE) {
        if ((!lpDepositPaused_ && lpDepositPaused) ||
            (!lpWithdrawPaused_ && lpWithdrawPaused) ||
            (!collateralDepositPaused_ && collateralDepositPaused) ||
            (!collateralWithdrawPaused_ && collateralWithdrawPaused) ||
            (!borrowPaused_ && borrowPaused) ||
            (!liquidationPaused_ && liquidationPaused)) {
            revert InvalidPauseAction();
        }

        lpDepositPaused = lpDepositPaused_;
        lpWithdrawPaused = lpWithdrawPaused_;
        collateralDepositPaused = collateralDepositPaused_;
        collateralWithdrawPaused = collateralWithdrawPaused_;
        borrowPaused = borrowPaused_;
        liquidationPaused = liquidationPaused_;

        emit PauseFlagsUpdated(
            lpDepositPaused_,
            lpWithdrawPaused_,
            collateralDepositPaused_,
            collateralWithdrawPaused_,
            borrowPaused_,
            liquidationPaused_
        );
    }

    function setRateModel(RateModel calldata rateModel_) external onlyRole(ADMIN_ROLE) {
        if (rateModel_.kinkUtilizationBps == 0 || rateModel_.kinkUtilizationBps > 10000) revert InvalidRateModel();
        if (rateModel_.maxRateBps != 0 && rateModel_.maxRateBps < rateModel_.minRateBps) revert InvalidRateModel();

        rateModel = rateModel_;
        emit RateModelUpdated(
            rateModel_.baseRateBps,
            rateModel_.kinkUtilizationBps,
            rateModel_.slope1Bps,
            rateModel_.slope2Bps,
            rateModel_.minRateBps,
            rateModel_.maxRateBps
        );
    }

    function setCollateralConfig(address asset, CollateralConfig calldata config) external onlyRole(ADMIN_ROLE) {
        if (asset == address(0)) revert InvalidAddress();
        if (config.borrowLtvBps >= config.liquidationThresholdBps) revert InvalidBps();
        if (config.liquidationThresholdBps > 9500) revert InvalidBps();
        if (config.liquidationBonusBps > 3000) revert InvalidBps();

        collateralConfigs[asset] = config;
        if (!isListedCollateral[asset]) {
            isListedCollateral[asset] = true;
            _collateralAssets.push(asset);
        }

        emit CollateralConfigured(
            asset,
            config.borrowLtvBps,
            config.liquidationThresholdBps,
            config.liquidationBonusBps,
            config.supplyCap,
            config.valueCapUsd,
            config.enabled
        );
    }

    function getCollateralConfig(address asset) external view returns (CollateralConfig memory) {
        return collateralConfigs[asset];
    }

    function getCollateralAssets() external view returns (address[] memory) {
        return _collateralAssets;
    }

    function computeBorrowRateBps(uint256 utilizationBps) external view returns (uint256 rateBps) {
        return _computeBorrowRateBps(utilizationBps);
    }

    function _computeBorrowRateBps(uint256 utilizationBps) internal view returns (uint256 rateBps) {
        if (utilizationBps > 10000) utilizationBps = 10000;

        RateModel memory model = rateModel;
        uint256 kink = model.kinkUtilizationBps;

        rateBps = model.baseRateBps;
        if (utilizationBps <= kink) {
            rateBps += (uint256(model.slope1Bps) * utilizationBps) / kink;
        } else {
            rateBps += model.slope1Bps;
            uint256 over = utilizationBps - kink;
            uint256 denom = 10000 - kink;
            if (denom > 0) {
                rateBps += (uint256(model.slope2Bps) * over) / denom;
            }
        }

        if (model.minRateBps != 0 && rateBps < model.minRateBps) rateBps = model.minRateBps;
        if (model.maxRateBps != 0 && rateBps > model.maxRateBps) rateBps = model.maxRateBps;
    }
}
