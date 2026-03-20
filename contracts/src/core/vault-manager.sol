// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ReentrancyGuard} from "../../lib/openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {RoleManager} from "../access/role-manager.sol";
import {WalletRegistry} from "../access/wallet-registry.sol";
import {IERC20} from "../interfaces/i-erc20.sol";
import {SafeErc20} from "../libraries/safe-erc20.sol";
import {DebtPool} from "./debt-pool.sol";
import {IPriceOracle} from "../oracle/i-price-oracle.sol";
import {MarketConfig} from "../policy/market-config.sol";

contract VaultManager is RoleManager, ReentrancyGuard {
    using SafeErc20 for address;

    uint256 internal constant BPS_DENOMINATOR = 10000;
    uint256 internal constant HEALTH_FACTOR_SCALE = 1e18;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidVault();
    error InvalidReceiver();
    error InvalidConfig();
    error UnsupportedCollateral();
    error CollateralDisabled();
    error CollateralCapExceeded();
    error InsufficientCollateral();
    error VaultHealthy();
    error NotVaultOwner();
    error HealthCheckFailed();
    error NothingToRepay();
    error DustDebt();
    error WalletNotAllowed();
    error PriceUnavailable();
    error ActionPaused();

    struct Vault {
        address owner;
        uint256 normalizedDebt;
    }

    address public immutable debtAsset;
    address public immutable liquidityPool;
    address public immutable marketConfig;

    address public walletRegistry;

    bytes32 public constant RISK_ROLE = keccak256("RISK_ROLE");

    uint256 public nextVaultId;

    mapping(uint256 => Vault) public vaults;
    mapping(uint256 => mapping(address => uint256)) public collateralBalances;
    mapping(uint256 => mapping(address => bool)) public vaultOperators;
    mapping(uint256 => mapping(address => bool)) public vaultHasCollateralAsset;
    mapping(uint256 => address[]) private _vaultCollateralAssets;
    mapping(address => uint256) public totalCollateralDeposits;

    event WalletRegistryUpdated(address indexed walletRegistry);
    event VaultOpened(uint256 indexed vaultId, address indexed owner);
    event VaultOperatorUpdated(uint256 indexed vaultId, address indexed operator, bool allowed);
    event CollateralDeposited(uint256 indexed vaultId, address indexed asset, uint256 amount);
    event CollateralWithdrawn(uint256 indexed vaultId, address indexed asset, uint256 amount, address to);
    event Borrowed(
        uint256 indexed vaultId,
        address indexed owner,
        address indexed receiver,
        uint256 amount,
        uint256 normalizedDebtAdded,
        uint256 borrowRateBps
    );
    event Repaid(
        uint256 indexed vaultId,
        address indexed payer,
        uint256 amount,
        uint256 normalizedDebtRepaid,
        uint256 remainingDebt
    );
    event Liquidated(
        uint256 indexed vaultId,
        address indexed liquidator,
        address indexed collateralAsset,
        uint256 repaidDebt,
        uint256 normalizedDebtRepaid,
        uint256 seizedCollateral,
        uint256 remainingDebt
    );
    event BadDebtResolved(
        uint256 indexed vaultId,
        address indexed resolver,
        address indexed collateralReceiver,
        uint256 writtenOffDebt,
        uint256 normalizedDebtWrittenOff
    );

    constructor(address admin, address debtAsset_, address liquidityPool_, address marketConfig_) RoleManager(admin) {
        if (debtAsset_ == address(0) || liquidityPool_ == address(0) || marketConfig_ == address(0)) revert InvalidAddress();
        if (DebtPool(liquidityPool_).ASSET() != debtAsset_) revert InvalidConfig();
        if (DebtPool(liquidityPool_).marketConfig() != marketConfig_) revert InvalidConfig();
        if (MarketConfig(marketConfig_).debtAsset() != debtAsset_) revert InvalidConfig();

        debtAsset = debtAsset_;
        liquidityPool = liquidityPool_;
        marketConfig = marketConfig_;
        nextVaultId = 1;
    }

    function setWalletRegistry(address walletRegistry_) external onlyRole(ADMIN_ROLE) {
        walletRegistry = walletRegistry_;
        emit WalletRegistryUpdated(walletRegistry_);
    }

    function setVaultOperator(uint256 vaultId, address operator, bool allowed) external {
        if (operator == address(0)) revert InvalidAddress();
        _requireVaultOwner(vaultId, msg.sender);
        vaultOperators[vaultId][operator] = allowed;
        emit VaultOperatorUpdated(vaultId, operator, allowed);
    }

    function openVault() external returns (uint256 vaultId) {
        _checkWallet(msg.sender);

        vaultId = nextVaultId++;
        vaults[vaultId] = Vault({owner: msg.sender, normalizedDebt: 0});

        emit VaultOpened(vaultId, msg.sender);
    }

    function depositCollateral(uint256 vaultId, address asset, uint256 amount) external nonReentrant {
        _checkWallet(msg.sender);
        if (amount == 0) revert InvalidAmount();
        if (MarketConfig(marketConfig).collateralDepositPaused()) revert ActionPaused();

        _requireVaultController(vaultId, msg.sender);
        MarketConfig.CollateralConfig memory config = MarketConfig(marketConfig).getCollateralConfig(asset);
        if (!_isCollateralConfigured(config)) revert UnsupportedCollateral();
        if (!config.enabled) revert CollateralDisabled();

        uint256 newTotal = totalCollateralDeposits[asset] + amount;
        if (config.supplyCap != 0 && newTotal > config.supplyCap) revert CollateralCapExceeded();
        if (config.valueCapUsd != 0 && _valueOf(asset, newTotal) > config.valueCapUsd) revert CollateralCapExceeded();

        if (!vaultHasCollateralAsset[vaultId][asset]) {
            vaultHasCollateralAsset[vaultId][asset] = true;
            _vaultCollateralAssets[vaultId].push(asset);
        }

        collateralBalances[vaultId][asset] += amount;
        totalCollateralDeposits[asset] = newTotal;
        asset.safeTransferFromExact(msg.sender, address(this), amount);

        emit CollateralDeposited(vaultId, asset, amount);
    }

    function withdrawCollateral(uint256 vaultId, address asset, uint256 amount, address to) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (to == address(0)) revert InvalidReceiver();
        if (MarketConfig(marketConfig).collateralWithdrawPaused()) revert ActionPaused();

        Vault storage vault = _requireVaultController(vaultId, msg.sender);
        if (msg.sender != vault.owner && to != vault.owner) revert InvalidReceiver();
        uint256 balance = collateralBalances[vaultId][asset];
        if (balance < amount) revert InsufficientCollateral();

        collateralBalances[vaultId][asset] = balance - amount;
        totalCollateralDeposits[asset] -= amount;

        uint256 debt = _debtOf(vault);
        if (debt != 0 && !_isBorrowCompliant(vaultId, debt)) revert HealthCheckFailed();

        asset.safeTransferExact(to, amount);
        emit CollateralWithdrawn(vaultId, asset, amount, to);
    }

    function borrow(uint256 vaultId, uint256 amount, address receiver)
        external
        nonReentrant
        returns (uint256 normalizedDebtAdded, uint256 borrowRateBps)
    {
        _checkWallet(msg.sender);
        if (amount == 0) revert InvalidAmount();
        if (receiver == address(0)) revert InvalidReceiver();
        if (MarketConfig(marketConfig).borrowPaused()) revert ActionPaused();

        Vault storage vault = _requireVaultController(vaultId, msg.sender);
        if (msg.sender != vault.owner && receiver != vault.owner) revert InvalidReceiver();
        MarketConfig config = MarketConfig(marketConfig);
        uint256 currentDebt = _debtOf(vault);
        if (currentDebt == 0 && config.minBorrowAmount() != 0 && amount < config.minBorrowAmount()) {
            revert InvalidAmount();
        }

        normalizedDebtAdded = DebtPool(liquidityPool).borrow(amount, receiver);
        vault.normalizedDebt += normalizedDebtAdded;

        uint256 newDebt = _debtOf(vault);
        if (config.minDebtAmount() != 0 && newDebt < config.minDebtAmount()) revert DustDebt();
        if (!_isBorrowCompliant(vaultId, newDebt)) revert HealthCheckFailed();

        borrowRateBps = DebtPool(liquidityPool).borrowRateBps();
        emit Borrowed(vaultId, msg.sender, receiver, amount, normalizedDebtAdded, borrowRateBps);
    }

    function repay(uint256 vaultId, uint256 maxAmount)
        external
        nonReentrant
        returns (uint256 repaid, uint256 normalizedDebtRepaid, uint256 remainingDebt)
    {
        if (maxAmount == 0) revert InvalidAmount();

        Vault storage vault = _requireVault(vaultId);
        uint256 debt = _debtOf(vault);
        if (debt == 0) revert NothingToRepay();

        (repaid, normalizedDebtRepaid, remainingDebt) = _planRepayment(vault.normalizedDebt, maxAmount);

        vault.normalizedDebt -= normalizedDebtRepaid;
        debtAsset.safeTransferFromExact(msg.sender, liquidityPool, repaid);
        DebtPool(liquidityPool).repay(normalizedDebtRepaid, repaid);

        emit Repaid(vaultId, msg.sender, repaid, normalizedDebtRepaid, remainingDebt);
    }

    function liquidate(uint256 vaultId, address collateralAsset, uint256 maxRepayAmount)
        external
        nonReentrant
        returns (uint256 repaid, uint256 normalizedDebtRepaid, uint256 seized)
    {
        if (maxRepayAmount == 0) revert InvalidAmount();
        if (MarketConfig(marketConfig).liquidationPaused()) revert ActionPaused();

        Vault storage vault = _requireVault(vaultId);
        uint256 debt = _debtOf(vault);
        if (debt == 0 || _isLiquidationCompliant(vaultId, debt)) revert VaultHealthy();

        uint256 collateralBalance = collateralBalances[vaultId][collateralAsset];
        if (collateralBalance == 0) revert InsufficientCollateral();

        MarketConfig config = MarketConfig(marketConfig);
        MarketConfig.CollateralConfig memory collateralConfig = config.getCollateralConfig(collateralAsset);
        if (!_isCollateralConfigured(collateralConfig)) revert UnsupportedCollateral();

        uint256 closeFactorCap = (debt * config.closeFactorBps()) / BPS_DENOMINATOR;
        if (closeFactorCap == 0) closeFactorCap = debt;

        uint256 maxByCollateral = _maxRepayableAgainstCollateral(collateralAsset, collateralBalance, collateralConfig.liquidationBonusBps);
        uint256 targetRepay = _min(maxRepayAmount, _min(debt, _min(closeFactorCap, maxByCollateral)));
        if (targetRepay == 0) revert InvalidAmount();

        uint256 remainingDebt;
        (repaid, normalizedDebtRepaid, remainingDebt) = _planRepayment(vault.normalizedDebt, targetRepay);
        if (remainingDebt != 0 && MarketConfig(marketConfig).minDebtAmount() != 0 && remainingDebt < MarketConfig(marketConfig).minDebtAmount()) {
            uint256 fullRepayCap = _min(maxRepayAmount, maxByCollateral);
            if (fullRepayCap < debt) revert DustDebt();
            repaid = debt;
            normalizedDebtRepaid = vault.normalizedDebt;
            remainingDebt = 0;
        }

        seized = _seizeAmountForRepay(collateralAsset, repaid, collateralConfig.liquidationBonusBps);
        if (seized > collateralBalance) revert InsufficientCollateral();

        vault.normalizedDebt -= normalizedDebtRepaid;
        collateralBalances[vaultId][collateralAsset] = collateralBalance - seized;
        totalCollateralDeposits[collateralAsset] -= seized;

        debtAsset.safeTransferFromExact(msg.sender, liquidityPool, repaid);
        DebtPool(liquidityPool).repay(normalizedDebtRepaid, repaid);
        collateralAsset.safeTransferExact(msg.sender, seized);

        emit Liquidated(vaultId, msg.sender, collateralAsset, repaid, normalizedDebtRepaid, seized, remainingDebt);
    }

    function resolveBadDebt(uint256 vaultId, address collateralReceiver)
        external
        onlyRole(RISK_ROLE)
        nonReentrant
        returns (uint256 writtenOffDebt, uint256 normalizedDebtWrittenOff)
    {
        if (collateralReceiver == address(0)) revert InvalidReceiver();

        Vault storage vault = _requireVault(vaultId);
        uint256 debtBeforeWriteOff = _debtOf(vault);
        if (debtBeforeWriteOff == 0) revert NothingToRepay();
        if (_isLiquidationCompliant(vaultId, debtBeforeWriteOff)) revert VaultHealthy();

        address[] storage assets = _vaultCollateralAssets[vaultId];
        for (uint256 i = 0; i < assets.length; ++i) {
            address asset = assets[i];
            uint256 balance = collateralBalances[vaultId][asset];
            if (balance == 0) continue;

            collateralBalances[vaultId][asset] = 0;
            totalCollateralDeposits[asset] -= balance;
            asset.safeTransferExact(collateralReceiver, balance);
        }

        normalizedDebtWrittenOff = vault.normalizedDebt;
        vault.normalizedDebt = 0;
        writtenOffDebt = DebtPool(liquidityPool).writeOff(normalizedDebtWrittenOff);

        emit BadDebtResolved(vaultId, msg.sender, collateralReceiver, writtenOffDebt, normalizedDebtWrittenOff);
    }

    function getVaultCollateralAssets(uint256 vaultId) external view returns (address[] memory) {
        return _vaultCollateralAssets[vaultId];
    }

    function debtOf(uint256 vaultId) external view returns (uint256) {
        return _debtOf(_requireVault(vaultId));
    }

    function collateralValueUsd(uint256 vaultId) external view returns (uint256) {
        (uint256 borrowCapacityUsd_, uint256 liquidationCapacityUsd_) = _collateralCapacitiesUsd(vaultId, true);
        if (borrowCapacityUsd_ == 0 && liquidationCapacityUsd_ == 0) return 0;

        address[] storage assets = _vaultCollateralAssets[vaultId];
        uint256 totalValue;
        for (uint256 i = 0; i < assets.length; ++i) {
            uint256 balance = collateralBalances[vaultId][assets[i]];
            if (balance == 0) continue;
            totalValue += _valueOf(assets[i], balance);
        }
        return totalValue;
    }

    function borrowCapacityUsd(uint256 vaultId) external view returns (uint256) {
        (uint256 borrowCapacityUsd_, ) = _collateralCapacitiesUsd(vaultId, false);
        return borrowCapacityUsd_;
    }

    function liquidationCapacityUsd(uint256 vaultId) external view returns (uint256) {
        (, uint256 liquidationCapacityUsd_) = _collateralCapacitiesUsd(vaultId, true);
        return liquidationCapacityUsd_;
    }

    function debtValueUsd(uint256 vaultId) external view returns (uint256) {
        return _valueOf(debtAsset, _debtOf(_requireVault(vaultId)));
    }

    function healthFactor(uint256 vaultId) external view returns (uint256) {
        uint256 debt = _debtOf(_requireVault(vaultId));
        if (debt == 0) return type(uint256).max;

        (, uint256 liquidationCapacityUsd_) = _collateralCapacitiesUsd(vaultId, true);
        uint256 debtValue = _valueOf(debtAsset, debt);
        if (debtValue == 0) return type(uint256).max;

        return (liquidationCapacityUsd_ * HEALTH_FACTOR_SCALE) / debtValue;
    }

    function currentBorrowRateBps() external view returns (uint256) {
        return DebtPool(liquidityPool).currentBorrowRateBps();
    }

    function _debtOf(Vault storage vault) internal view returns (uint256) {
        return DebtPool(liquidityPool).debtFromNormalized(vault.normalizedDebt);
    }

    function _planRepayment(uint256 normalizedDebt, uint256 maxAmount)
        internal
        view
        returns (uint256 repaid, uint256 normalizedDebtRepaid, uint256 remainingDebt)
    {
        uint256 debt = DebtPool(liquidityPool).debtFromNormalized(normalizedDebt);
        repaid = maxAmount > debt ? debt : maxAmount;

        if (repaid == debt) {
            normalizedDebtRepaid = normalizedDebt;
            return (repaid, normalizedDebtRepaid, 0);
        }

        normalizedDebtRepaid = DebtPool(liquidityPool).normalizedDebtFromAssetsDown(repaid);
        if (normalizedDebtRepaid == 0 || normalizedDebtRepaid > normalizedDebt) revert InvalidAmount();

        repaid = DebtPool(liquidityPool).debtFromNormalized(normalizedDebtRepaid);
        if (repaid == 0) revert InvalidAmount();

        remainingDebt = DebtPool(liquidityPool).debtFromNormalized(normalizedDebt - normalizedDebtRepaid);
        uint256 minDebtAmount = MarketConfig(marketConfig).minDebtAmount();
        if (remainingDebt != 0 && minDebtAmount != 0 && remainingDebt < minDebtAmount) revert DustDebt();
    }

    function _collateralCapacitiesUsd(uint256 vaultId, bool includeDisabled)
        internal
        view
        returns (uint256 borrowCapacityUsd_, uint256 liquidationCapacityUsd_)
    {
        address[] storage assets = _vaultCollateralAssets[vaultId];
        for (uint256 i = 0; i < assets.length; ++i) {
            address asset = assets[i];
            uint256 balance = collateralBalances[vaultId][asset];
            if (balance == 0) continue;

            MarketConfig.CollateralConfig memory config = MarketConfig(marketConfig).getCollateralConfig(asset);
            if (!_isCollateralConfigured(config)) revert UnsupportedCollateral();
            if (!includeDisabled && !config.enabled) continue;

            uint256 valueUsd = _valueOf(asset, balance);
            borrowCapacityUsd_ += (valueUsd * config.borrowLtvBps) / BPS_DENOMINATOR;
            liquidationCapacityUsd_ += (valueUsd * config.liquidationThresholdBps) / BPS_DENOMINATOR;
        }
    }

    function _isBorrowCompliant(uint256 vaultId, uint256 debt) internal view returns (bool) {
        if (debt == 0) return true;

        (uint256 borrowCapacityUsd_, ) = _collateralCapacitiesUsd(vaultId, false);
        uint256 debtValueUsd_ = _valueOf(debtAsset, debt);
        return debtValueUsd_ <= borrowCapacityUsd_;
    }

    function _isLiquidationCompliant(uint256 vaultId, uint256 debt) internal view returns (bool) {
        if (debt == 0) return true;

        (, uint256 liquidationCapacityUsd_) = _collateralCapacitiesUsd(vaultId, true);
        uint256 debtValueUsd_ = _valueOf(debtAsset, debt);
        return debtValueUsd_ <= liquidationCapacityUsd_;
    }

    function _maxRepayableAgainstCollateral(address collateralAsset, uint256 collateralAmount, uint16 liquidationBonusBps)
        internal
        view
        returns (uint256)
    {
        uint256 collateralValueUsd_ = _valueOf(collateralAsset, collateralAmount);
        uint256 maxDebtValueUsd_ = (collateralValueUsd_ * BPS_DENOMINATOR) / (BPS_DENOMINATOR + liquidationBonusBps);
        return _amountFromValue(debtAsset, maxDebtValueUsd_);
    }

    function _seizeAmountForRepay(address collateralAsset, uint256 repaidDebt, uint16 liquidationBonusBps)
        internal
        view
        returns (uint256)
    {
        uint256 debtValueUsd_ = _valueOf(debtAsset, repaidDebt);
        uint256 seizeValueUsd_ = (debtValueUsd_ * (BPS_DENOMINATOR + liquidationBonusBps)) / BPS_DENOMINATOR;
        return _amountFromValueRoundUp(collateralAsset, seizeValueUsd_);
    }

    function _valueOf(address asset, uint256 amount) internal view returns (uint256) {
        uint256 price = IPriceOracle(MarketConfig(marketConfig).priceOracle()).getPrice(asset);
        if (price == 0) revert PriceUnavailable();
        uint8 decimals = IERC20(asset).decimals();
        return (amount * price) / (10 ** decimals);
    }

    function _amountFromValue(address asset, uint256 valueUsd_) internal view returns (uint256) {
        uint256 price = IPriceOracle(MarketConfig(marketConfig).priceOracle()).getPrice(asset);
        if (price == 0) revert PriceUnavailable();
        uint8 decimals = IERC20(asset).decimals();
        return (valueUsd_ * (10 ** decimals)) / price;
    }

    function _amountFromValueRoundUp(address asset, uint256 valueUsd_) internal view returns (uint256) {
        uint256 price = IPriceOracle(MarketConfig(marketConfig).priceOracle()).getPrice(asset);
        if (price == 0) revert PriceUnavailable();
        uint8 decimals = IERC20(asset).decimals();
        uint256 scale = 10 ** decimals;
        return _divUp(valueUsd_ * scale, price);
    }

    function _checkWallet(address account) internal view {
        if (walletRegistry != address(0) && !WalletRegistry(walletRegistry).isWalletAllowed(account)) {
            revert WalletNotAllowed();
        }
    }

    function _isCollateralConfigured(MarketConfig.CollateralConfig memory config) internal pure returns (bool) {
        return config.borrowLtvBps != 0 && config.liquidationThresholdBps != 0;
    }

    function _requireVault(uint256 vaultId) internal view returns (Vault storage vault) {
        vault = vaults[vaultId];
        if (vault.owner == address(0)) revert InvalidVault();
    }

    function _requireVaultOwner(uint256 vaultId, address owner) internal view returns (Vault storage vault) {
        vault = _requireVault(vaultId);
        if (vault.owner != owner) revert NotVaultOwner();
    }

    function _requireVaultController(uint256 vaultId, address operator) internal view returns (Vault storage vault) {
        vault = _requireVault(vaultId);
        if (vault.owner != operator && !vaultOperators[vaultId][operator]) revert NotVaultOwner();
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _divUp(uint256 numerator, uint256 denominator) internal pure returns (uint256) {
        return numerator == 0 ? 0 : ((numerator - 1) / denominator) + 1;
    }
}
