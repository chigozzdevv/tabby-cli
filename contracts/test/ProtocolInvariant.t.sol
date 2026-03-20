// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "../lib/openzeppelin-contracts/lib/forge-std/src/Test.sol";
import {DebtPool} from "../src/core/debt-pool.sol";
import {VaultManager} from "../src/core/vault-manager.sol";
import {ChainlinkPriceOracle} from "../src/oracle/chainlink-price-oracle.sol";
import {MarketConfig} from "../src/policy/market-config.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockERC20StrictApprove} from "./mocks/MockERC20StrictApprove.sol";
import {MockChainlinkAggregatorV3} from "./mocks/MockChainlinkAggregatorV3.sol";

contract ProtocolHandler is Test {
    address internal constant LP = address(0x1111);
    address internal constant LP2 = address(0x2222);
    address internal constant BORROWER = address(0xBEEF);
    address internal constant BORROWER2 = address(0xBEE2);
    address internal constant BORROWER3 = address(0xBEE3);

    MockERC20StrictApprove internal immutable usdt0;
    MockERC20 internal immutable weth;
    MockERC20 internal immutable wbtc;
    MockERC20 internal immutable xaut0;
    DebtPool internal immutable pool;
    VaultManager internal immutable vaultManager;

    address[] internal borrowers;
    address[] internal lpAccounts;

    mapping(address => uint256) internal _vaultIdOf;
    address[] internal _vaultOwners;

    constructor(
        MockERC20StrictApprove usdt0_,
        MockERC20 weth_,
        MockERC20 wbtc_,
        MockERC20 xaut0_,
        DebtPool pool_,
        VaultManager vaultManager_
    ) {
        usdt0 = usdt0_;
        weth = weth_;
        wbtc = wbtc_;
        xaut0 = xaut0_;
        pool = pool_;
        vaultManager = vaultManager_;

        borrowers.push(BORROWER);
        borrowers.push(BORROWER2);
        borrowers.push(BORROWER3);

        lpAccounts.push(LP);
        lpAccounts.push(LP2);

        for (uint256 i = 0; i < borrowers.length; ++i) {
            vm.startPrank(borrowers[i]);
            weth.approve(address(vaultManager), type(uint256).max);
            wbtc.approve(address(vaultManager), type(uint256).max);
            xaut0.approve(address(vaultManager), type(uint256).max);
            usdt0.approve(address(vaultManager), 0);
            usdt0.approve(address(vaultManager), type(uint256).max);
            vm.stopPrank();
        }

        for (uint256 i = 0; i < lpAccounts.length; ++i) {
            vm.startPrank(lpAccounts[i]);
            usdt0.approve(address(pool), 0);
            usdt0.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
    }

    function openVaultWithWeth(uint256 borrowerSeed, uint256 collateralSeed) external {
        address borrower = borrowers[borrowerSeed % borrowers.length];
        if (_vaultIdOf[borrower] != 0) return;

        uint256 collateralAmount = bound(collateralSeed, 10 ether, 200 ether);
        weth.mint(borrower, collateralAmount);

        vm.startPrank(borrower);
        uint256 vaultId = vaultManager.openVault();
        vaultManager.depositCollateral(vaultId, address(weth), collateralAmount);
        vm.stopPrank();

        _vaultIdOf[borrower] = vaultId;
        _vaultOwners.push(borrower);
    }

    function depositWeth(uint256 borrowerSeed, uint256 amountSeed) external {
        address borrower = borrowers[borrowerSeed % borrowers.length];
        uint256 vaultId = _vaultIdOf[borrower];
        if (vaultId == 0) return;

        uint256 amount = bound(amountSeed, 1 ether, 50 ether);
        weth.mint(borrower, amount);

        vm.prank(borrower);
        vaultManager.depositCollateral(vaultId, address(weth), amount);
    }

    function depositWbtc(uint256 borrowerSeed, uint256 amountSeed) external {
        address borrower = borrowers[borrowerSeed % borrowers.length];
        uint256 vaultId = _vaultIdOf[borrower];
        if (vaultId == 0) return;

        uint256 amount = bound(amountSeed, 1e7, 5e8);
        wbtc.mint(borrower, amount);

        vm.prank(borrower);
        vaultManager.depositCollateral(vaultId, address(wbtc), amount);
    }

    function depositXaut(uint256 borrowerSeed, uint256 amountSeed) external {
        address borrower = borrowers[borrowerSeed % borrowers.length];
        uint256 vaultId = _vaultIdOf[borrower];
        if (vaultId == 0) return;

        uint256 amount = bound(amountSeed, 10 * 1e6, 500 * 1e6);
        xaut0.mint(borrower, amount);

        vm.prank(borrower);
        vaultManager.depositCollateral(vaultId, address(xaut0), amount);
    }

    function borrow(uint256 borrowerSeed, uint256 amountSeed) external {
        address borrower = borrowers[borrowerSeed % borrowers.length];
        uint256 vaultId = _vaultIdOf[borrower];
        if (vaultId == 0) return;

        uint256 capacityUsd = vaultManager.borrowCapacityUsd(vaultId);
        uint256 debtUsd = vaultManager.debtValueUsd(vaultId);
        if (capacityUsd <= debtUsd) return;

        uint256 maxBorrow = ((capacityUsd - debtUsd) * 1e6) / 1e18;
        if (maxBorrow < 100 * 1e6) return;

        uint256 amount = bound(amountSeed, 100 * 1e6, maxBorrow);
        vm.prank(borrower);
        try vaultManager.borrow(vaultId, amount, borrower) {} catch {}
    }

    function repay(uint256 borrowerSeed, uint256 amountSeed) external {
        address borrower = borrowers[borrowerSeed % borrowers.length];
        uint256 vaultId = _vaultIdOf[borrower];
        if (vaultId == 0) return;

        uint256 debt = vaultManager.debtOf(vaultId);
        if (debt == 0) return;

        uint256 amount = bound(amountSeed, 1, debt);
        usdt0.mint(borrower, amount);

        vm.prank(borrower);
        try vaultManager.repay(vaultId, amount) {} catch {}
    }

    function withdrawWeth(uint256 borrowerSeed, uint256 amountSeed) external {
        address borrower = borrowers[borrowerSeed % borrowers.length];
        uint256 vaultId = _vaultIdOf[borrower];
        if (vaultId == 0) return;

        uint256 balance = vaultManager.collateralBalances(vaultId, address(weth));
        if (balance == 0) return;

        uint256 amount = bound(amountSeed, 1, balance);
        vm.prank(borrower);
        try vaultManager.withdrawCollateral(vaultId, address(weth), amount, borrower) {} catch {}
    }

    function lpDeposit(uint256 lpSeed, uint256 amountSeed) external {
        address lp = lpAccounts[lpSeed % lpAccounts.length];
        uint256 amount = bound(amountSeed, 1_000 * 1e6, 100_000 * 1e6);

        usdt0.mint(lp, amount);
        vm.prank(lp);
        try pool.deposit(amount) {} catch {}
    }

    function lpWithdraw(uint256 lpSeed, uint256 shareSeed) external {
        address lp = lpAccounts[lpSeed % lpAccounts.length];
        uint256 shares = pool.balanceOf(lp);
        if (shares == 0) return;

        uint256 amount = bound(shareSeed, 1, shares);
        vm.prank(lp);
        try pool.withdraw(amount) {} catch {}
    }

    function warpAndAccrue(uint256 timeSeed) external {
        uint256 jump = bound(timeSeed, 1 hours, 3 days);
        vm.warp(block.timestamp + jump);
        try pool.accrue() {} catch {}
    }

    function vaultOwners() external view returns (address[] memory) {
        return _vaultOwners;
    }

    function vaultIdOf(address owner) external view returns (uint256) {
        return _vaultIdOf[owner];
    }
}

contract ProtocolInvariantTest is Test {
    address internal constant LP = address(0x1111);

    MockERC20StrictApprove internal usdt0;
    MockERC20 internal weth;
    MockERC20 internal wbtc;
    MockERC20 internal xaut0;

    DebtPool internal pool;
    ChainlinkPriceOracle internal oracle;
    MarketConfig internal config;
    VaultManager internal vaultManager;
    ProtocolHandler internal handler;

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

        MockChainlinkAggregatorV3 usdtFeed = new MockChainlinkAggregatorV3(8, 1e8);
        MockChainlinkAggregatorV3 wethFeed = new MockChainlinkAggregatorV3(8, 2_000e8);
        MockChainlinkAggregatorV3 wbtcFeed = new MockChainlinkAggregatorV3(8, 60_000e8);
        MockChainlinkAggregatorV3 xautFeed = new MockChainlinkAggregatorV3(8, 3_000e8);

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

        handler = new ProtocolHandler(usdt0, weth, wbtc, xaut0, pool, vaultManager);
        targetContract(address(handler));
    }

    function invariant_totalNormalizedDebtMatchesAllVaults() public view {
        address[] memory owners = handler.vaultOwners();
        uint256 totalNormalizedDebt;

        for (uint256 i = 0; i < owners.length; ++i) {
            uint256 vaultId = handler.vaultIdOf(owners[i]);
            (, uint256 normalizedDebt) = vaultManager.vaults(vaultId);
            totalNormalizedDebt += normalizedDebt;
        }

        assertEq(totalNormalizedDebt, pool.totalNormalizedDebt(), "pool debt should equal summed vault debt");
    }

    function invariant_totalCollateralMatchesTrackedVaultBalances() public view {
        address[] memory owners = handler.vaultOwners();
        uint256 wethTotal;
        uint256 wbtcTotal;
        uint256 xautTotal;

        for (uint256 i = 0; i < owners.length; ++i) {
            uint256 vaultId = handler.vaultIdOf(owners[i]);
            wethTotal += vaultManager.collateralBalances(vaultId, address(weth));
            wbtcTotal += vaultManager.collateralBalances(vaultId, address(wbtc));
            xautTotal += vaultManager.collateralBalances(vaultId, address(xaut0));
        }

        assertEq(wethTotal, vaultManager.totalCollateralDeposits(address(weth)), "weth totals should match");
        assertEq(wbtcTotal, vaultManager.totalCollateralDeposits(address(wbtc)), "wbtc totals should match");
        assertEq(xautTotal, vaultManager.totalCollateralDeposits(address(xaut0)), "xaut totals should match");
    }
}
