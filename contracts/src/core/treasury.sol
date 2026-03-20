// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ReentrancyGuard} from "../../lib/openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {RoleManager} from "../access/role-manager.sol";
import {SafeErc20} from "../libraries/safe-erc20.sol";

contract Treasury is RoleManager, ReentrancyGuard {
    using SafeErc20 for address;

    error NativeTransferFailed();
    error InvalidReceiver();

    event FundsWithdrawn(address indexed token, address indexed to, uint256 amount, address indexed sender);

    constructor(address admin) RoleManager(admin) {}

    function withdraw(address token, address to, uint256 amount) external onlyRole(ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert InvalidReceiver();
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            token.safeTransferExact(to, amount);
        }
        emit FundsWithdrawn(token, to, amount, msg.sender);
    }

    receive() external payable {}
}
