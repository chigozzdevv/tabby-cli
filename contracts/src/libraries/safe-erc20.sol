// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "../interfaces/i-erc20.sol";

library SafeErc20 {
    error Erc20CallFailed();
    error UnexpectedTransferAmount();

    function safeTransfer(address token, address to, uint256 amount) internal {
        _call(token, abi.encodeWithSignature("transfer(address,uint256)", to, amount));
    }

    function safeTransferExact(address token, address to, uint256 amount) internal {
        uint256 balanceBefore = IERC20(token).balanceOf(to);
        _call(token, abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        uint256 balanceAfter = IERC20(token).balanceOf(to);
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != amount) {
            revert UnexpectedTransferAmount();
        }
    }

    function safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        _call(token, abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount));
    }

    function safeTransferFromExact(address token, address from, address to, uint256 amount) internal {
        uint256 balanceBefore = IERC20(token).balanceOf(to);
        _call(token, abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount));
        uint256 balanceAfter = IERC20(token).balanceOf(to);
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != amount) {
            revert UnexpectedTransferAmount();
        }
    }

    function safeApprove(address token, address spender, uint256 amount) internal {
        _call(token, abi.encodeWithSignature("approve(address,uint256)", spender, amount));
    }

    function _call(address token, bytes memory data) private {
        (bool success, bytes memory result) = token.call(data);
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert Erc20CallFailed();
        }
    }
}
