// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {RoleManager} from "./role-manager.sol";

contract WalletRegistry is RoleManager {
    error InvalidArrayLength();

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    event WalletStatusUpdated(address indexed wallet, bool allowed, address indexed sender);

    mapping(address => bool) private _allowed;

    constructor(address admin) RoleManager(admin) {
        _grantRole(OPERATOR_ROLE, admin);
    }

    function setWalletStatus(address wallet, bool allowed) external onlyRole(OPERATOR_ROLE) {
        _allowed[wallet] = allowed;
        emit WalletStatusUpdated(wallet, allowed, msg.sender);
    }

    function setWalletStatuses(address[] calldata wallets, bool[] calldata allowed) external onlyRole(OPERATOR_ROLE) {
        uint256 length = wallets.length;
        if (length != allowed.length) revert InvalidArrayLength();

        for (uint256 i = 0; i < length; ++i) {
            _allowed[wallets[i]] = allowed[i];
            emit WalletStatusUpdated(wallets[i], allowed[i], msg.sender);
        }
    }

    function isWalletAllowed(address wallet) external view returns (bool) {
        return _allowed[wallet];
    }
}
