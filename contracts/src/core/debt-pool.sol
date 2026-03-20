// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ReentrancyGuard} from "../../lib/openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {RoleManager} from "../access/role-manager.sol";
import {WalletRegistry} from "../access/wallet-registry.sol";
import {IERC20} from "../interfaces/i-erc20.sol";
import {SafeErc20} from "../libraries/safe-erc20.sol";
import {MarketConfig} from "../policy/market-config.sol";

contract DebtPool is RoleManager, ReentrancyGuard {
    using SafeErc20 for address;

    error InvalidAmount();
    error InvalidAsset();
    error InvalidReceiver();
    error InvalidFeeBps();
    error InvalidAccount();
    error InvalidConfig();
    error InvalidNormalizedDebt();
    error WalletNotAllowed();
    error InsufficientLiquidity();
    error ActionPaused();
    error DebtCapExceeded();

    uint256 internal constant BPS_DENOMINATOR = 10000;
    uint256 internal constant INDEX_SCALE = 1e27;
    uint256 internal constant YEAR = 365 days;

    uint16 public constant MAX_PROTOCOL_FEE_BPS = 1000;

    address public immutable ASSET;
    address public immutable marketConfig;

    address public walletRegistry;

    bytes32 public constant BORROW_ROLE = keccak256("BORROW_ROLE");
    bytes32 public constant REPAY_ROLE = keccak256("REPAY_ROLE");
    bytes32 public constant RISK_ROLE = keccak256("RISK_ROLE");

    uint16 public treasuryFeeBps;
    address public treasuryFeeRecipient;

    uint256 public totalShares;
    mapping(address => uint256) public balanceOf;

    uint256 public totalNormalizedDebt;
    uint256 public borrowIndex;
    uint64 public lastAccruedAt;
    uint32 public borrowRateBps;

    event Deposited(address indexed account, uint256 assets, uint256 shares);
    event Withdrawn(address indexed account, uint256 assets, uint256 shares);
    event Accrued(uint256 interestAccrued, uint256 feeAssets, uint256 borrowIndex, uint256 totalDebtAssets, uint256 borrowRateBps);
    event Borrowed(address indexed receiver, uint256 assets, uint256 normalizedDebtAdded, uint256 borrowRateBps);
    event Repaid(address indexed payer, uint256 assets, uint256 normalizedDebtRepaid, uint256 borrowRateBps);
    event WrittenOff(uint256 assets, uint256 normalizedDebtWrittenOff, uint256 borrowRateBps);
    event WalletRegistryUpdated(address indexed walletRegistry);
    event FeeConfigUpdated(uint16 treasuryFeeBps);
    event FeeRecipientUpdated(address indexed treasuryFeeRecipient);
    event FeeSharesMinted(uint256 interestAssets, uint256 feeAssets, uint256 feeShares, uint256 treasuryShares);

    constructor(address admin, address asset_, address marketConfig_) RoleManager(admin) {
        if (asset_ == address(0) || marketConfig_ == address(0)) revert InvalidConfig();
        if (MarketConfig(marketConfig_).debtAsset() != asset_) revert InvalidConfig();

        ASSET = asset_;
        marketConfig = marketConfig_;
        borrowIndex = INDEX_SCALE;
        lastAccruedAt = uint64(block.timestamp);
    }

    function setWalletRegistry(address walletRegistry_) external onlyRole(ADMIN_ROLE) {
        walletRegistry = walletRegistry_;
        emit WalletRegistryUpdated(walletRegistry_);
    }

    function setFeeConfig(uint16 treasuryFeeBps_) external onlyRole(ADMIN_ROLE) {
        if (treasuryFeeBps_ > MAX_PROTOCOL_FEE_BPS) revert InvalidFeeBps();
        treasuryFeeBps = treasuryFeeBps_;
        emit FeeConfigUpdated(treasuryFeeBps_);
    }

    function setFeeRecipient(address treasuryFeeRecipient_) external onlyRole(ADMIN_ROLE) {
        treasuryFeeRecipient = treasuryFeeRecipient_;
        emit FeeRecipientUpdated(treasuryFeeRecipient_);
    }

    function totalDebtAssets() public view returns (uint256) {
        return _debtFromNormalized(totalNormalizedDebt, _previewBorrowIndex());
    }

    function totalAssets() public view returns (uint256) {
        return availableLiquidity() + totalDebtAssets();
    }

    function availableLiquidity() public view returns (uint256) {
        return IERC20(ASSET).balanceOf(address(this));
    }

    function liquidityIndex() public view returns (uint256) {
        uint256 projectedTotalShares = _previewTotalShares();
        if (projectedTotalShares == 0) return INDEX_SCALE;
        return (totalAssets() * INDEX_SCALE) / projectedTotalShares;
    }

    function utilizationBps() public view returns (uint256) {
        return _utilizationBps(totalDebtAssets(), availableLiquidity());
    }

    function currentBorrowRateBps() public view returns (uint256) {
        return _computeBorrowRateBps(totalDebtAssets(), availableLiquidity());
    }

    function previewBorrowIndex() external view returns (uint256) {
        return _previewBorrowIndex();
    }

    function previewTotalShares() external view returns (uint256) {
        return _previewTotalShares();
    }

    function debtFromNormalized(uint256 normalizedDebt) public view returns (uint256) {
        return _debtFromNormalized(normalizedDebt, _previewBorrowIndex());
    }

    function normalizedDebtFromAssetsDown(uint256 assets) public view returns (uint256) {
        return _normalizedDebtFromAssets(assets, _previewBorrowIndex(), false);
    }

    function normalizedDebtFromAssetsUp(uint256 assets) public view returns (uint256) {
        return _normalizedDebtFromAssets(assets, _previewBorrowIndex(), true);
    }

    function previewDeposit(uint256 assets) external view returns (uint256 shares) {
        if (assets == 0) return 0;

        uint256 projectedTotalAssets = totalAssets();
        uint256 projectedTotalShares = _previewTotalShares();
        if (projectedTotalShares == 0 || projectedTotalAssets == 0) return assets;
        return (assets * projectedTotalShares) / projectedTotalAssets;
    }

    function previewWithdraw(uint256 shares) external view returns (uint256 assets) {
        if (shares == 0) return 0;

        uint256 projectedTotalShares = _previewTotalShares();
        if (projectedTotalShares == 0) return 0;
        return (shares * totalAssets()) / projectedTotalShares;
    }

    function deposit(uint256 assets) external nonReentrant returns (uint256 shares) {
        _checkWallet(msg.sender);
        if (assets == 0) revert InvalidAmount();
        if (MarketConfig(marketConfig).lpDepositPaused()) revert ActionPaused();

        _accrue();

        uint256 assetsBefore = availableLiquidity() + _debtFromNormalized(totalNormalizedDebt, borrowIndex);
        if (totalShares == 0 || assetsBefore == 0) {
            shares = assets;
        } else {
            shares = (assets * totalShares) / assetsBefore;
        }
        if (shares == 0) revert InvalidAmount();

        totalShares += shares;
        balanceOf[msg.sender] += shares;
        ASSET.safeTransferFromExact(msg.sender, address(this), assets);
        emit Deposited(msg.sender, assets, shares);
    }

    function withdraw(uint256 shares) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert InvalidAmount();
        uint256 accountShares = balanceOf[msg.sender];
        if (shares > accountShares) revert InvalidAmount();
        if (MarketConfig(marketConfig).lpWithdrawPaused()) revert ActionPaused();

        _accrue();

        assets = (shares * (availableLiquidity() + _debtFromNormalized(totalNormalizedDebt, borrowIndex))) / totalShares;
        if (assets == 0) revert InvalidAmount();
        if (assets > availableLiquidity()) revert InsufficientLiquidity();

        balanceOf[msg.sender] = accountShares - shares;
        totalShares -= shares;
        ASSET.safeTransferExact(msg.sender, assets);
        emit Withdrawn(msg.sender, assets, shares);
    }

    function accrue() external nonReentrant returns (uint256 interestAccrued) {
        return _accrue();
    }

    function _accrue() internal returns (uint256 interestAccrued) {
        uint256 previousIndex = borrowIndex;
        uint256 nextIndex = _previewBorrowIndex();
        if (block.timestamp != lastAccruedAt) {
            lastAccruedAt = uint64(block.timestamp);
        }

        uint256 totalDebtBefore = _debtFromNormalized(totalNormalizedDebt, previousIndex);
        uint256 totalDebtAfter = _debtFromNormalized(totalNormalizedDebt, nextIndex);
        interestAccrued = totalDebtAfter - totalDebtBefore;

        borrowIndex = nextIndex;
        uint256 feeAssets = _mintFeeShares(interestAccrued, totalDebtAfter);
        uint256 nextBorrowRateBps = _computeBorrowRateBps(totalDebtAfter, availableLiquidity());
        // casting to uint32 is safe because MarketConfig bounds rates to uint16-based inputs and optional maxRateBps.
        // forge-lint: disable-next-line(unsafe-typecast)
        borrowRateBps = uint32(nextBorrowRateBps);

        if (interestAccrued != 0 || feeAssets != 0 || nextBorrowRateBps != 0) {
            emit Accrued(interestAccrued, feeAssets, nextIndex, totalDebtAfter, nextBorrowRateBps);
        }
    }

    function borrow(uint256 assets, address receiver)
        external
        onlyRole(BORROW_ROLE)
        nonReentrant
        returns (uint256 normalizedDebtAdded)
    {
        if (assets == 0) revert InvalidAmount();
        if (receiver == address(0)) revert InvalidReceiver();
        if (MarketConfig(marketConfig).borrowPaused()) revert ActionPaused();

        _accrue();

        if (assets > availableLiquidity()) revert InsufficientLiquidity();
        uint256 currentDebt = _debtFromNormalized(totalNormalizedDebt, borrowIndex);
        uint256 debtCap_ = MarketConfig(marketConfig).debtCap();
        if (debtCap_ != 0 && currentDebt + assets > debtCap_) revert DebtCapExceeded();

        normalizedDebtAdded = _normalizedDebtFromAssets(assets, borrowIndex, true);
        if (normalizedDebtAdded == 0) revert InvalidAmount();

        totalNormalizedDebt += normalizedDebtAdded;
        uint256 liquidityAfter = availableLiquidity() - assets;
        uint256 nextBorrowRateBps = _computeBorrowRateBps(_debtFromNormalized(totalNormalizedDebt, borrowIndex), liquidityAfter);
        // casting to uint32 is safe because MarketConfig bounds rates to uint16-based inputs and optional maxRateBps.
        // forge-lint: disable-next-line(unsafe-typecast)
        borrowRateBps = uint32(nextBorrowRateBps);
        ASSET.safeTransferExact(receiver, assets);

        emit Borrowed(receiver, assets, normalizedDebtAdded, nextBorrowRateBps);
    }

    function repay(uint256 normalizedDebtRepaid, uint256 assets) external onlyRole(REPAY_ROLE) nonReentrant {
        if (assets == 0) revert InvalidAmount();
        if (normalizedDebtRepaid == 0 || normalizedDebtRepaid > totalNormalizedDebt) revert InvalidNormalizedDebt();

        _accrue();

        totalNormalizedDebt -= normalizedDebtRepaid;
        uint256 nextBorrowRateBps = _computeBorrowRateBps(_debtFromNormalized(totalNormalizedDebt, borrowIndex), availableLiquidity());
        // casting to uint32 is safe because MarketConfig bounds rates to uint16-based inputs and optional maxRateBps.
        // forge-lint: disable-next-line(unsafe-typecast)
        borrowRateBps = uint32(nextBorrowRateBps);

        emit Repaid(msg.sender, assets, normalizedDebtRepaid, nextBorrowRateBps);
    }

    function writeOff(uint256 normalizedDebtWrittenOff)
        external
        onlyRole(RISK_ROLE)
        nonReentrant
        returns (uint256 assetsWrittenOff)
    {
        if (normalizedDebtWrittenOff == 0 || normalizedDebtWrittenOff > totalNormalizedDebt) revert InvalidNormalizedDebt();

        _accrue();

        assetsWrittenOff = _debtFromNormalized(normalizedDebtWrittenOff, borrowIndex);
        totalNormalizedDebt -= normalizedDebtWrittenOff;
        uint256 nextBorrowRateBps = _computeBorrowRateBps(_debtFromNormalized(totalNormalizedDebt, borrowIndex), availableLiquidity());
        // casting to uint32 is safe because MarketConfig bounds rates to uint16-based inputs and optional maxRateBps.
        // forge-lint: disable-next-line(unsafe-typecast)
        borrowRateBps = uint32(nextBorrowRateBps);

        emit WrittenOff(assetsWrittenOff, normalizedDebtWrittenOff, nextBorrowRateBps);
    }

    function _checkWallet(address account) internal view {
        if (account == address(0)) revert InvalidAccount();
        if (walletRegistry != address(0) && !WalletRegistry(walletRegistry).isWalletAllowed(account)) {
            revert WalletNotAllowed();
        }
    }

    function _previewBorrowIndex() internal view returns (uint256) {
        uint256 rateBps_ = borrowRateBps;
        uint256 normalizedDebt = totalNormalizedDebt;
        uint256 elapsed = block.timestamp - uint256(lastAccruedAt);
        if (normalizedDebt == 0 || rateBps_ == 0 || elapsed == 0) return borrowIndex;

        return borrowIndex + ((borrowIndex * rateBps_ * elapsed) / YEAR / BPS_DENOMINATOR);
    }

    function _previewTotalShares() internal view returns (uint256) {
        uint256 currentTotalShares = totalShares;
        if (currentTotalShares == 0) return 0;

        uint256 previousIndex = borrowIndex;
        uint256 nextIndex = _previewBorrowIndex();
        if (nextIndex == previousIndex) return currentTotalShares;

        uint256 totalDebtBefore = _debtFromNormalized(totalNormalizedDebt, previousIndex);
        uint256 totalDebtAfter = _debtFromNormalized(totalNormalizedDebt, nextIndex);
        uint256 interestAccrued = totalDebtAfter - totalDebtBefore;
        if (interestAccrued == 0) return currentTotalShares;

        return currentTotalShares + _previewFeeShares(interestAccrued, totalDebtAfter, currentTotalShares);
    }

    function _computeBorrowRateBps(uint256 debtAssets, uint256 liquidityAssets) internal view returns (uint256) {
        return MarketConfig(marketConfig).computeBorrowRateBps(_utilizationBps(debtAssets, liquidityAssets));
    }

    function _utilizationBps(uint256 debtAssets, uint256 liquidityAssets) internal pure returns (uint256) {
        uint256 totalAssets_ = debtAssets + liquidityAssets;
        if (debtAssets == 0 || totalAssets_ == 0) return 0;
        if (debtAssets >= totalAssets_) return BPS_DENOMINATOR;
        return (debtAssets * BPS_DENOMINATOR) / totalAssets_;
    }

    function _debtFromNormalized(uint256 normalizedDebt, uint256 index) internal pure returns (uint256) {
        if (normalizedDebt == 0) return 0;
        return (normalizedDebt * index) / INDEX_SCALE;
    }

    function _normalizedDebtFromAssets(uint256 assets, uint256 index, bool roundUp) internal pure returns (uint256) {
        if (assets == 0) return 0;

        uint256 numerator = assets * INDEX_SCALE;
        if (!roundUp) return numerator / index;
        return _divUp(numerator, index);
    }

    function _mintFeeShares(uint256 interestAssets, uint256 totalDebtAfterAccrual) internal returns (uint256 feeAssets) {
        if (interestAssets == 0 || totalShares == 0) return 0;

        address treasuryRecipient = treasuryFeeRecipient;
        uint256 treasuryBps = treasuryFeeBps;
        if (treasuryRecipient == address(0) || treasuryBps == 0) return 0;

        feeAssets = (interestAssets * treasuryBps) / BPS_DENOMINATOR;
        if (feeAssets == 0) return 0;

        uint256 assetsBeforeFeeMint = availableLiquidity() + totalDebtAfterAccrual;
        if (assetsBeforeFeeMint <= feeAssets) return 0;

        uint256 sharesBefore = totalShares;
        uint256 feeShares = (feeAssets * sharesBefore) / (assetsBeforeFeeMint - feeAssets);
        if (feeShares == 0) return 0;

        totalShares = sharesBefore + feeShares;
        balanceOf[treasuryRecipient] += feeShares;
        emit FeeSharesMinted(interestAssets, feeAssets, feeShares, feeShares);
    }

    function _previewFeeShares(uint256 interestAssets, uint256 totalDebtAfterAccrual, uint256 sharesBefore)
        internal
        view
        returns (uint256 feeShares)
    {
        if (interestAssets == 0 || sharesBefore == 0) return 0;

        uint256 treasuryBps = treasuryFeeBps;
        if (treasuryFeeRecipient == address(0) || treasuryBps == 0) return 0;

        uint256 feeAssets = (interestAssets * treasuryBps) / BPS_DENOMINATOR;
        if (feeAssets == 0) return 0;

        uint256 assetsBeforeFeeMint = availableLiquidity() + totalDebtAfterAccrual;
        if (assetsBeforeFeeMint <= feeAssets) return 0;

        return (feeAssets * sharesBefore) / (assetsBeforeFeeMint - feeAssets);
    }
    function _divUp(uint256 numerator, uint256 denominator) internal pure returns (uint256) {
        return numerator == 0 ? 0 : ((numerator - 1) / denominator) + 1;
    }
}
