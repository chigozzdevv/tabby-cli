// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {TimelockController} from "../lib/openzeppelin-contracts/contracts/governance/TimelockController.sol";
import {RoleManager} from "../src/access/role-manager.sol";
import {WalletRegistry} from "../src/access/wallet-registry.sol";
import {DebtPool} from "../src/core/debt-pool.sol";
import {VaultManager} from "../src/core/vault-manager.sol";
import {SafeErc20} from "../src/libraries/safe-erc20.sol";
import {ChainlinkPriceOracle} from "../src/oracle/chainlink-price-oracle.sol";
import {MarketConfig} from "../src/policy/market-config.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockERC20StrictApprove} from "./mocks/MockERC20StrictApprove.sol";
import {MockFeeOnTransferERC20} from "./mocks/MockFeeOnTransferERC20.sol";
import {MockChainlinkAggregatorV3} from "./mocks/MockChainlinkAggregatorV3.sol";

interface Vm {
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function warp(uint256 newTimestamp) external;
    function expectRevert(bytes4 selector) external;
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertEq(uint256 a, uint256 b, string memory message) internal pure {
        require(a == b, message);
    }

    function assertEq(uint256 a, uint256 b) internal pure {
        require(a == b, "assertEq");
    }

    function assertGt(uint256 a, uint256 b, string memory message) internal pure {
        require(a > b, message);
    }

    function assertLt(uint256 a, uint256 b, string memory message) internal pure {
        require(a < b, message);
    }

    function assertTrue(bool ok, string memory message) internal pure {
        require(ok, message);
    }

    function assertApproxAbs(uint256 a, uint256 b, uint256 maxDelta, string memory message) internal pure {
        uint256 delta = a > b ? a - b : b - a;
        require(delta <= maxDelta, message);
    }

    function boundUint256(uint256 x, uint256 min, uint256 max) internal pure returns (uint256) {
        require(max >= min, "bound");
        if (max == min) return min;
        return min + (x % (max - min + 1));
    }
}

contract ProtocolTest is TestBase {
    address internal constant LP = address(0x1111);
    address internal constant LP2 = address(0x2222);
    address internal constant BORROWER = address(0xBEEF);
    address internal constant BORROWER2 = address(0xBEE2);
    address internal constant LIQUIDATOR = address(0xCAFE);
    address internal constant EMERGENCY = address(0xEEEE);
    address internal constant GOVERNANCE = address(0xABCD);
    address internal constant OPS = address(0x0A11);
    address internal constant TREASURY = address(0xAAAA);

    MockERC20StrictApprove internal usdt0;
    MockERC20 internal weth;
    MockERC20 internal wbtc;
    MockERC20 internal xaut0;

    DebtPool internal pool;
    ChainlinkPriceOracle internal oracle;
    MarketConfig internal config;
    VaultManager internal vaultManager;

    MockChainlinkAggregatorV3 internal usdtFeed;
    MockChainlinkAggregatorV3 internal wethFeed;
    MockChainlinkAggregatorV3 internal wbtcFeed;
    MockChainlinkAggregatorV3 internal xautFeed;

    function setUp() public {
        usdt0 = new MockERC20StrictApprove("Tether USD0", "USDT0", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        wbtc = new MockERC20("Wrapped Bitcoin", "WBTC", 8);
        xaut0 = new MockERC20("Tether Gold 0", "XAUt0", 6);

        oracle = new ChainlinkPriceOracle(address(this));
        config = new MarketConfig(address(this), address(usdt0), address(oracle));
        pool = new DebtPool(address(this), address(usdt0), address(config));
        vaultManager = new VaultManager(address(this), address(usdt0), address(pool), address(config));

        pool.grantRole(pool.BORROW_ROLE(), address(vaultManager));
        pool.grantRole(pool.REPAY_ROLE(), address(vaultManager));
        pool.grantRole(pool.RISK_ROLE(), address(vaultManager));

        config.setRiskParams(5000, 100 * 1e6, 100 * 1e6);

        usdtFeed = new MockChainlinkAggregatorV3(8, 1e8);
        wethFeed = new MockChainlinkAggregatorV3(8, 2_000e8);
        wbtcFeed = new MockChainlinkAggregatorV3(8, 60_000e8);
        xautFeed = new MockChainlinkAggregatorV3(8, 3_000e8);

        oracle.setFeed(address(usdt0), address(usdtFeed), 0, true);
        oracle.setFeed(address(weth), address(wethFeed), 0, true);
        oracle.setFeed(address(wbtc), address(wbtcFeed), 0, true);
        oracle.setFeed(address(xaut0), address(xautFeed), 0, true);

        config.setCollateralConfig(
            address(weth),
            MarketConfig.CollateralConfig({
                borrowLtvBps: 7000,
                liquidationThresholdBps: 7750,
                liquidationBonusBps: 500,
                supplyCap: 1_000_000 ether,
                valueCapUsd: 0,
                enabled: true
            })
        );
        config.setCollateralConfig(
            address(wbtc),
            MarketConfig.CollateralConfig({
                borrowLtvBps: 7250,
                liquidationThresholdBps: 8000,
                liquidationBonusBps: 700,
                supplyCap: 100_000 * 1e8,
                valueCapUsd: 0,
                enabled: true
            })
        );
        config.setCollateralConfig(
            address(xaut0),
            MarketConfig.CollateralConfig({
                borrowLtvBps: 5500,
                liquidationThresholdBps: 6500,
                liquidationBonusBps: 500,
                supplyCap: 1_000_000 * 1e6,
                valueCapUsd: 0,
                enabled: true
            })
        );

        usdt0.mint(LP, 1_000_000 * 1e6);
        vm.startPrank(LP);
        usdt0.approve(address(pool), type(uint256).max);
        pool.deposit(1_000_000 * 1e6);
        vm.stopPrank();
    }

    function test_vaultManager_lpEarnsUsdt0YieldFromBorrowers() external {
        uint256 vaultId = _openWethVault(BORROWER, 100 ether, 100_000 * 1e6);

        vm.warp(block.timestamp + 30 days);
        uint256 debt = vaultManager.debtOf(vaultId);

        usdt0.mint(BORROWER, debt);
        vm.startPrank(BORROWER);
        usdt0.approve(address(vaultManager), type(uint256).max);
        vaultManager.repay(vaultId, debt);
        vm.stopPrank();

        uint256 lpShares = pool.balanceOf(LP);
        vm.prank(LP);
        uint256 withdrawn = pool.withdraw(lpShares);

        assertGt(withdrawn, 1_000_000 * 1e6, "lp should earn USDT0 yield");
        assertEq(pool.totalDebtAssets(), 0, "outstanding debt cleared");
    }

    function test_debtPool_accruedInterestDoesNotDiluteExistingLpOnNewDeposit() external {
        _openWethVault(BORROWER, 100 ether, 100_000 * 1e6);

        vm.warp(block.timestamp + 30 days);

        uint256 lp1Shares = pool.balanceOf(LP);
        uint256 lp1PreviewBefore = pool.previewWithdraw(lp1Shares);

        usdt0.mint(LP2, 100_000 * 1e6);
        vm.startPrank(LP2);
        usdt0.approve(address(pool), type(uint256).max);
        pool.deposit(100_000 * 1e6);
        vm.stopPrank();

        uint256 lp1PreviewAfter = pool.previewWithdraw(lp1Shares);
        assertApproxAbs(lp1PreviewAfter, lp1PreviewBefore, 2, "new LP should not capture accrued yield");

        uint256 lp2Shares = pool.balanceOf(LP2);
        uint256 lp2Preview = pool.previewWithdraw(lp2Shares);
        assertLt(lp2Preview, 100_001 * 1e6, "new LP should not get a windfall");
    }

    function test_debtPool_rateChangesApplyToExistingBorrowersThroughGlobalIndex() external {
        uint256 start = block.timestamp;
        uint256 vaultId1 = _openWethVault(BORROWER, 150 ether, 100_000 * 1e6);
        uint256 initialRate = pool.borrowRateBps();

        vm.warp(start + 15 days);
        uint256 debtMid = vaultManager.debtOf(vaultId1);

        _openWethVault(BORROWER2, 600 ether, 500_000 * 1e6);
        uint256 higherRate = pool.borrowRateBps();

        vm.warp(start + 30 days);
        uint256 debtEnd = vaultManager.debtOf(vaultId1);

        uint256 firstHalfInterest = debtMid - (100_000 * 1e6);
        uint256 secondHalfInterest = debtEnd - debtMid;

        assertGt(higherRate, initialRate, "utilization increase should move the borrow rate");
        assertGt(secondHalfInterest, firstHalfInterest, "existing borrower should accrue at the higher global rate");
    }

    function test_walletRegistry_blocksRiskIncreasingActionsButAllowsOrderlyExit() external {
        WalletRegistry registry = new WalletRegistry(address(this));
        registry.setWalletStatus(LP, true);
        registry.setWalletStatus(BORROWER, true);

        pool.setWalletRegistry(address(registry));
        vaultManager.setWalletRegistry(address(registry));

        weth.mint(BORROWER, 100 ether);
        vm.startPrank(BORROWER);
        uint256 vaultId = vaultManager.openVault();
        weth.approve(address(vaultManager), type(uint256).max);
        vaultManager.depositCollateral(vaultId, address(weth), 100 ether);
        vaultManager.borrow(vaultId, 50_000 * 1e6, BORROWER);
        vm.stopPrank();

        registry.setWalletStatus(BORROWER, false);

        weth.mint(BORROWER, 10 ether);
        vm.startPrank(BORROWER);
        vm.expectRevert(VaultManager.WalletNotAllowed.selector);
        vaultManager.borrow(vaultId, 1_000 * 1e6, BORROWER);

        vm.expectRevert(VaultManager.WalletNotAllowed.selector);
        vaultManager.openVault();
        vm.stopPrank();

        uint256 debt = vaultManager.debtOf(vaultId);
        usdt0.mint(BORROWER, debt);
        vm.startPrank(BORROWER);
        usdt0.approve(address(vaultManager), type(uint256).max);
        vaultManager.repay(vaultId, debt);
        vaultManager.withdrawCollateral(vaultId, address(weth), 100 ether, BORROWER);
        vm.stopPrank();

        registry.setWalletStatus(LP, false);
        uint256 lpShares = pool.balanceOf(LP);
        vm.prank(LP);
        uint256 withdrawn = pool.withdraw(lpShares);

        assertEq(withdrawn > 0 ? 1 : 0, 1, "disallowed LP should still be able to exit");
        assertEq(weth.balanceOf(BORROWER), 110 ether, "borrower should recover collateral after repaying");
    }

    function test_marketDebtCapBlocksBorrowAboveCap() external {
        config.setDebtCap(60_000 * 1e6);

        _openWethVault(BORROWER, 100 ether, 50_000 * 1e6);

        weth.mint(BORROWER2, 100 ether);
        vm.startPrank(BORROWER2);
        uint256 vaultId = vaultManager.openVault();
        weth.approve(address(vaultManager), type(uint256).max);
        vaultManager.depositCollateral(vaultId, address(weth), 100 ether);
        vm.expectRevert(DebtPool.DebtCapExceeded.selector);
        vaultManager.borrow(vaultId, 11_000 * 1e6, BORROWER2);
        vm.stopPrank();
    }

    function test_marketConfig_guardianCanPauseButCannotUnpause() external {
        config.grantRole(config.GUARDIAN_ROLE(), EMERGENCY);

        vm.startPrank(EMERGENCY);
        config.guardianPauseFlags(true, false, true, false, true, false);
        vm.stopPrank();

        assertTrue(config.lpDepositPaused(), "guardian should be able to pause lp deposits");
        assertTrue(config.collateralDepositPaused(), "guardian should be able to pause collateral deposits");
        assertTrue(config.borrowPaused(), "guardian should be able to pause borrowing");

        vm.startPrank(EMERGENCY);
        vm.expectRevert(MarketConfig.InvalidPauseAction.selector);
        config.guardianPauseFlags(false, false, false, false, false, false);
        vm.stopPrank();

        config.setPauseFlags(false, false, false, false, false, false);
        assertTrue(!config.borrowPaused(), "admin should be able to unpause");
    }

    function test_timelockOwnsAdminAfterHandoff() external {
        address[] memory proposers = new address[](1);
        proposers[0] = GOVERNANCE;
        address[] memory executors = new address[](1);
        executors[0] = GOVERNANCE;
        TimelockController timelock = new TimelockController(2 days, proposers, executors, address(this));

        config.grantRole(config.ADMIN_ROLE(), address(timelock));
        config.revokeRole(config.ADMIN_ROLE(), address(this));

        vm.expectRevert(RoleManager.Unauthorized.selector);
        config.setDebtCap(200_000 * 1e6);

        bytes memory callData = abi.encodeCall(MarketConfig.setDebtCap, (200_000 * 1e6));
        bytes32 salt = keccak256("set-debt-cap");

        vm.prank(GOVERNANCE);
        timelock.schedule(address(config), 0, callData, bytes32(0), salt, 2 days);

        vm.warp(block.timestamp + 2 days);

        vm.prank(GOVERNANCE);
        timelock.execute(address(config), 0, callData, bytes32(0), salt);

        assertEq(config.debtCap(), 200_000 * 1e6, "timelock should control admin changes");
    }

    function test_vaultOperator_canManageVaultButCannotRedirectAssets() external {
        weth.mint(BORROWER, 100 ether);

        vm.startPrank(BORROWER);
        uint256 vaultId = vaultManager.openVault();
        weth.approve(address(vaultManager), type(uint256).max);
        vaultManager.depositCollateral(vaultId, address(weth), 100 ether);
        vaultManager.setVaultOperator(vaultId, OPS, true);
        vm.stopPrank();

        vm.prank(OPS);
        vaultManager.borrow(vaultId, 10_000 * 1e6, BORROWER);

        vm.prank(OPS);
        vm.expectRevert(VaultManager.InvalidReceiver.selector);
        vaultManager.borrow(vaultId, 1_000 * 1e6, OPS);

        uint256 debt = vaultManager.debtOf(vaultId);
        usdt0.mint(OPS, debt);
        vm.startPrank(OPS);
        usdt0.approve(address(vaultManager), type(uint256).max);
        vaultManager.repay(vaultId, debt);

        vm.expectRevert(VaultManager.InvalidReceiver.selector);
        vaultManager.withdrawCollateral(vaultId, address(weth), 100 ether, OPS);

        vaultManager.withdrawCollateral(vaultId, address(weth), 100 ether, BORROWER);
        vm.stopPrank();

        assertEq(weth.balanceOf(BORROWER), 100 ether, "operator should only release collateral back to the owner");
    }

    function test_walletRegistry_operatorCanUpdateWithoutAdmin() external {
        WalletRegistry registry = new WalletRegistry(address(this));
        registry.grantRole(registry.OPERATOR_ROLE(), OPS);
        registry.revokeRole(registry.OPERATOR_ROLE(), address(this));

        vm.expectRevert(RoleManager.Unauthorized.selector);
        registry.setWalletStatus(BORROWER, true);

        address[] memory wallets = new address[](2);
        wallets[0] = BORROWER;
        wallets[1] = BORROWER2;
        bool[] memory allowed = new bool[](2);
        allowed[0] = true;
        allowed[1] = false;

        vm.prank(OPS);
        registry.setWalletStatuses(wallets, allowed);

        assertTrue(registry.isWalletAllowed(BORROWER), "ops safe should allowlist wallets");
        assertTrue(!registry.isWalletAllowed(BORROWER2), "ops safe should also offboard wallets");
    }

    function test_deflationaryDebtAssetIsRejectedOnLpDeposit() external {
        MockFeeOnTransferERC20 feeUsdt = new MockFeeOnTransferERC20("Fee USD", "fUSD", 6, 100);
        ChainlinkPriceOracle localOracle = new ChainlinkPriceOracle(address(this));
        MarketConfig localConfig = new MarketConfig(address(this), address(feeUsdt), address(localOracle));
        DebtPool localPool = new DebtPool(address(this), address(feeUsdt), address(localConfig));

        feeUsdt.mint(LP2, 100_000 * 1e6);
        vm.startPrank(LP2);
        feeUsdt.approve(address(localPool), type(uint256).max);
        vm.expectRevert(SafeErc20.UnexpectedTransferAmount.selector);
        localPool.deposit(100_000 * 1e6);
        vm.stopPrank();
    }

    function test_deflationaryCollateralIsRejectedOnDeposit() external {
        MockFeeOnTransferERC20 feeWeth = new MockFeeOnTransferERC20("Fee Ether", "fWETH", 18, 100);
        MockChainlinkAggregatorV3 feeWethFeed = new MockChainlinkAggregatorV3(8, 2_000e8);

        oracle.setFeed(address(feeWeth), address(feeWethFeed), 0, true);
        config.setCollateralConfig(
            address(feeWeth),
            MarketConfig.CollateralConfig({
                borrowLtvBps: 7000,
                liquidationThresholdBps: 7750,
                liquidationBonusBps: 500,
                supplyCap: 1_000_000 ether,
                valueCapUsd: 0,
                enabled: true
            })
        );

        feeWeth.mint(BORROWER, 10 ether);
        vm.startPrank(BORROWER);
        uint256 vaultId = vaultManager.openVault();
        feeWeth.approve(address(vaultManager), type(uint256).max);
        vm.expectRevert(SafeErc20.UnexpectedTransferAmount.selector);
        vaultManager.depositCollateral(vaultId, address(feeWeth), 10 ether);
        vm.stopPrank();
    }

    function test_pauseFlagsFreezeRiskPathsWithoutBlockingRepay() external {
        uint256 vaultId = _openWethVault(BORROWER, 100 ether, 50_000 * 1e6);

        config.setPauseFlags(true, false, true, true, true, true);

        usdt0.mint(LP2, 10_000 * 1e6);
        vm.startPrank(LP2);
        usdt0.approve(address(pool), type(uint256).max);
        vm.expectRevert(DebtPool.ActionPaused.selector);
        pool.deposit(10_000 * 1e6);
        vm.stopPrank();

        weth.mint(BORROWER, 10 ether);
        vm.startPrank(BORROWER);
        weth.approve(address(vaultManager), type(uint256).max);
        vm.expectRevert(VaultManager.ActionPaused.selector);
        vaultManager.depositCollateral(vaultId, address(weth), 1 ether);

        vm.expectRevert(VaultManager.ActionPaused.selector);
        vaultManager.borrow(vaultId, 1_000 * 1e6, BORROWER);

        vm.expectRevert(VaultManager.ActionPaused.selector);
        vaultManager.withdrawCollateral(vaultId, address(weth), 1 ether, BORROWER);
        vm.stopPrank();

        wethFeed.setAnswer(500e8);
        usdt0.mint(LIQUIDATOR, 1_000 * 1e6);
        vm.startPrank(LIQUIDATOR);
        usdt0.approve(address(vaultManager), type(uint256).max);
        vm.expectRevert(VaultManager.ActionPaused.selector);
        vaultManager.liquidate(vaultId, address(weth), 1_000 * 1e6);
        vm.stopPrank();

        uint256 debt = vaultManager.debtOf(vaultId);
        usdt0.mint(BORROWER, debt);
        vm.startPrank(BORROWER);
        usdt0.approve(address(vaultManager), type(uint256).max);
        vaultManager.repay(vaultId, debt);
        vm.stopPrank();

        assertEq(vaultManager.debtOf(vaultId), 0, "repay should stay available during a pause");
    }

    function test_resolveBadDebtWritesOffPoolDebtAndSweepsCollateral() external {
        vaultManager.grantRole(vaultManager.RISK_ROLE(), address(this));
        uint256 vaultId = _openWethVault(BORROWER, 5 ether, 6_000 * 1e6);

        wethFeed.setAnswer(500e8);
        uint256 poolDebtBefore = pool.totalDebtAssets();

        (uint256 writtenOffDebt, uint256 normalizedDebtWrittenOff) = vaultManager.resolveBadDebt(vaultId, TREASURY);

        assertEq(vaultManager.debtOf(vaultId), 0, "vault debt should be cleared");
        assertEq(pool.totalDebtAssets(), poolDebtBefore - writtenOffDebt, "pool debt should be written down");
        assertGt(normalizedDebtWrittenOff, 0, "normalized debt should be removed");
        assertEq(weth.balanceOf(TREASURY), 5 ether, "remaining collateral should be swept");
    }

    function test_writeOffSocializesLossToPoolNav() external {
        pool.setFeeConfig(500);
        pool.setFeeRecipient(TREASURY);
        vaultManager.grantRole(vaultManager.RISK_ROLE(), address(this));

        uint256 vaultId = _openWethVault(BORROWER, 5 ether, 6_000 * 1e6);

        vm.warp(block.timestamp + 30 days);
        pool.accrue();

        uint256 lpShares = pool.balanceOf(LP);
        uint256 totalSharesBefore = pool.totalShares();
        uint256 lpValueBefore = pool.previewWithdraw(lpShares);
        uint256 treasurySharesBefore = pool.balanceOf(TREASURY);
        assertGt(treasurySharesBefore, 0, "treasury should hold accrued fee shares");

        wethFeed.setAnswer(500e8);
        (uint256 writtenOffDebt,) = vaultManager.resolveBadDebt(vaultId, TREASURY);

        uint256 lpValueAfter = pool.previewWithdraw(lpShares);
        uint256 actualLpLoss = lpValueBefore - lpValueAfter;
        uint256 expectedLpLoss = (writtenOffDebt * lpShares) / totalSharesBefore;

        assertEq(pool.balanceOf(TREASURY), treasurySharesBefore, "writeoff should not burn treasury shares");
        assertApproxAbs(actualLpLoss, expectedLpLoss, 2, "writeoff should reduce pool nav pro rata");
    }

    function test_vaultManager_usesMultipleCollateralAndBlocksUnsafeWithdraw() external {
        weth.mint(BORROWER, 1 ether);
        wbtc.mint(BORROWER, 2_000_000);

        vm.startPrank(BORROWER);
        uint256 vaultId = vaultManager.openVault();
        weth.approve(address(vaultManager), type(uint256).max);
        wbtc.approve(address(vaultManager), type(uint256).max);

        vaultManager.depositCollateral(vaultId, address(weth), 1 ether);
        vaultManager.depositCollateral(vaultId, address(wbtc), 2_000_000);
        vaultManager.borrow(vaultId, 2_000 * 1e6, BORROWER);

        vm.expectRevert(VaultManager.HealthCheckFailed.selector);
        vaultManager.withdrawCollateral(vaultId, address(wbtc), 2_000_000, BORROWER);
        vm.stopPrank();
    }

    function test_vaultManager_supportsXaut0Collateral() external {
        xaut0.mint(BORROWER, 20 * 1e6);

        vm.startPrank(BORROWER);
        uint256 vaultId = vaultManager.openVault();
        xaut0.approve(address(vaultManager), type(uint256).max);
        vaultManager.depositCollateral(vaultId, address(xaut0), 20 * 1e6);
        vaultManager.borrow(vaultId, 20_000 * 1e6, BORROWER);
        vm.stopPrank();

        assertEq(usdt0.balanceOf(BORROWER), 20_000 * 1e6, "borrower received USDT0");
        assertTrue(vaultManager.healthFactor(vaultId) > 1e18, "vault should remain healthy");
    }

    function test_vaultManager_partialLiquidationRepaysDebtAndSeizesChosenCollateral() external {
        weth.mint(BORROWER, 5 ether);
        wbtc.mint(BORROWER, 5_000_000);

        vm.startPrank(BORROWER);
        uint256 vaultId = vaultManager.openVault();
        weth.approve(address(vaultManager), type(uint256).max);
        wbtc.approve(address(vaultManager), type(uint256).max);
        vaultManager.depositCollateral(vaultId, address(weth), 5 ether);
        vaultManager.depositCollateral(vaultId, address(wbtc), 5_000_000);
        vaultManager.borrow(vaultId, 7_000 * 1e6, BORROWER);
        vm.stopPrank();

        wethFeed.setAnswer(1_000e8);
        assertTrue(vaultManager.healthFactor(vaultId) < 1e18, "vault should be liquidatable");

        usdt0.mint(LIQUIDATOR, 3_500 * 1e6);
        vm.startPrank(LIQUIDATOR);
        usdt0.approve(address(vaultManager), type(uint256).max);
        (uint256 repaid, uint256 normalizedDebtRepaid, uint256 seized) =
            vaultManager.liquidate(vaultId, address(weth), 3_500 * 1e6);
        vm.stopPrank();

        assertEq(repaid, 3_500 * 1e6, "close factor repayment");
        assertGt(normalizedDebtRepaid, 0, "normalized debt should be burned");
        assertGt(seized, 3 ether, "liquidator should seize discounted WETH");
        assertEq(vaultManager.collateralBalances(vaultId, address(wbtc)), 5_000_000, "btc collateral untouched");
        assertEq(vaultManager.debtOf(vaultId), 3_500 * 1e6, "remaining debt");
    }

    function test_debtPool_mintsFeeSharesToTreasury() external {
        pool.setFeeConfig(500);
        pool.setFeeRecipient(TREASURY);

        _openWethVault(BORROWER, 100 ether, 50_000 * 1e6);

        vm.warp(block.timestamp + 30 days);
        pool.accrue();

        assertGt(pool.balanceOf(TREASURY), 0, "treasury should receive fee shares");
    }

    function test_vaultManager_enforcesCollateralSupplyCap() external {
        config.setCollateralConfig(
            address(xaut0),
            MarketConfig.CollateralConfig({
                borrowLtvBps: 5500,
                liquidationThresholdBps: 6500,
                liquidationBonusBps: 500,
                supplyCap: 10 * 1e6,
                valueCapUsd: 0,
                enabled: true
            })
        );

        xaut0.mint(BORROWER, 20 * 1e6);

        vm.startPrank(BORROWER);
        uint256 vaultId = vaultManager.openVault();
        xaut0.approve(address(vaultManager), type(uint256).max);
        vm.expectRevert(VaultManager.CollateralCapExceeded.selector);
        vaultManager.depositCollateral(vaultId, address(xaut0), 20 * 1e6);
        vm.stopPrank();
    }

    function test_vaultManager_enforcesCollateralValueCap() external {
        config.setCollateralConfig(
            address(xaut0),
            MarketConfig.CollateralConfig({
                borrowLtvBps: 5500,
                liquidationThresholdBps: 6500,
                liquidationBonusBps: 500,
                supplyCap: 0,
                valueCapUsd: 30_000 * 1e18,
                enabled: true
            })
        );

        xaut0.mint(BORROWER, 20 * 1e6);

        vm.startPrank(BORROWER);
        uint256 vaultId = vaultManager.openVault();
        xaut0.approve(address(vaultManager), type(uint256).max);
        vm.expectRevert(VaultManager.CollateralCapExceeded.selector);
        vaultManager.depositCollateral(vaultId, address(xaut0), 20 * 1e6);
        vm.stopPrank();
    }

    function test_disabledCollateralStopsNewBorrowCapacityButPreservesHealth() external {
        uint256 vaultId = _openWethVault(BORROWER, 10 ether, 8_000 * 1e6);

        config.setCollateralConfig(
            address(weth),
            MarketConfig.CollateralConfig({
                borrowLtvBps: 7000,
                liquidationThresholdBps: 7750,
                liquidationBonusBps: 500,
                supplyCap: 1_000_000 ether,
                valueCapUsd: 0,
                enabled: false
            })
        );

        assertTrue(vaultManager.healthFactor(vaultId) > 1e18, "existing vault should keep health from disabled collateral");

        vm.startPrank(BORROWER);
        vm.expectRevert(VaultManager.HealthCheckFailed.selector);
        vaultManager.borrow(vaultId, 1 * 1e6, BORROWER);
        vm.stopPrank();
    }

    function testFuzz_fullRepayZeroesDebt(uint96 collateralSeed, uint96 borrowSeed, uint32 daysElapsedSeed) external {
        uint256 collateralAmount = boundUint256(uint256(collateralSeed), 2 ether, 200 ether);
        uint256 maxBorrow = _maxBorrowFromWeth(collateralAmount);
        uint256 borrowAmount = boundUint256(uint256(borrowSeed), 100 * 1e6, maxBorrow / 2);
        uint256 daysElapsed = boundUint256(uint256(daysElapsedSeed), 1, 90);

        uint256 vaultId = _openWethVault(BORROWER, collateralAmount, borrowAmount);

        vm.warp(block.timestamp + (daysElapsed * 1 days));
        uint256 debt = vaultManager.debtOf(vaultId);

        usdt0.mint(BORROWER, debt);
        vm.startPrank(BORROWER);
        usdt0.approve(address(vaultManager), type(uint256).max);
        vaultManager.repay(vaultId, debt);
        vm.stopPrank();

        assertEq(vaultManager.debtOf(vaultId), 0, "full repay should clear the vault");
    }

    function testFuzz_previewDepositMatchesActualShares(uint96 borrowSeed, uint32 daysElapsedSeed, uint96 depositSeed) external {
        uint256 borrowAmount = boundUint256(uint256(borrowSeed), 50_000 * 1e6, 200_000 * 1e6);
        uint256 depositAmount = boundUint256(uint256(depositSeed), 1_000 * 1e6, 200_000 * 1e6);
        uint256 daysElapsed = boundUint256(uint256(daysElapsedSeed), 1, 60);

        _openWethVault(BORROWER, 200 ether, borrowAmount);

        vm.warp(block.timestamp + (daysElapsed * 1 days));

        uint256 previewShares = pool.previewDeposit(depositAmount);

        usdt0.mint(LP2, depositAmount);
        vm.startPrank(LP2);
        usdt0.approve(address(pool), type(uint256).max);
        pool.deposit(depositAmount);
        vm.stopPrank();

        assertEq(pool.balanceOf(LP2), previewShares, "previewDeposit should match minted shares");
    }

    function test_chainlinkOracle_aliasResolvesCanonicalFeed() external {
        ChainlinkPriceOracle aliasOracle = new ChainlinkPriceOracle(address(this));
        MockERC20 canonicalXaut = new MockERC20("Tether Gold", "XAUT", 6);
        MockChainlinkAggregatorV3 canonicalFeed = new MockChainlinkAggregatorV3(8, 3_000e8);

        aliasOracle.setFeed(address(canonicalXaut), address(canonicalFeed), 0, true);
        aliasOracle.setAlias(address(xaut0), address(canonicalXaut));

        assertEq(aliasOracle.getPrice(address(xaut0)), 3_000e18, "alias should resolve canonical feed");
    }

    function _openWethVault(address owner, uint256 collateralAmount, uint256 borrowAmount) internal returns (uint256 vaultId) {
        weth.mint(owner, collateralAmount);

        vm.startPrank(owner);
        vaultId = vaultManager.openVault();
        weth.approve(address(vaultManager), type(uint256).max);
        vaultManager.depositCollateral(vaultId, address(weth), collateralAmount);
        if (borrowAmount != 0) {
            vaultManager.borrow(vaultId, borrowAmount, owner);
        }
        vm.stopPrank();
    }

    function _maxBorrowFromWeth(uint256 collateralAmount) internal pure returns (uint256) {
        return (collateralAmount * 2_000 * 1e6 * 7000) / 1e18 / 10000;
    }
}
