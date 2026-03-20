// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

abstract contract RoleManager {
    error Unauthorized();
    error InvalidRoleAccount();

    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    mapping(bytes32 => mapping(address => bool)) private _roles;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    modifier onlyRole(bytes32 role) {
        _onlyRole(role);
        _;
    }

    constructor(address admin) {
        if (admin == address(0)) revert InvalidRoleAccount();
        _grantRole(ADMIN_ROLE, admin);
    }

    function hasRole(bytes32 role, address account) public view returns (bool) {
        return _roles[role][account];
    }

    function grantRole(bytes32 role, address account) external onlyRole(ADMIN_ROLE) {
        if (account == address(0)) revert InvalidRoleAccount();
        _grantRole(role, account);
    }

    function revokeRole(bytes32 role, address account) external onlyRole(ADMIN_ROLE) {
        if (account == address(0)) revert InvalidRoleAccount();
        if (_roles[role][account]) {
            _roles[role][account] = false;
            emit RoleRevoked(role, account, msg.sender);
        }
    }

    function renounceRole(bytes32 role) external {
        if (_roles[role][msg.sender]) {
            _roles[role][msg.sender] = false;
            emit RoleRevoked(role, msg.sender, msg.sender);
        }
    }

    function _grantRole(bytes32 role, address account) internal {
        if (!_roles[role][account]) {
            _roles[role][account] = true;
            emit RoleGranted(role, account, msg.sender);
        }
    }

    function _onlyRole(bytes32 role) internal view {
        if (!_roles[role][msg.sender]) revert Unauthorized();
    }
}
