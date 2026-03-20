// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {MockERC20} from "./MockERC20.sol";

contract MockFeeOnTransferERC20 is MockERC20 {
    uint16 public immutable feeBps;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint16 feeBps_)
        MockERC20(name_, symbol_, decimals_)
    {
        feeBps = feeBps_;
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        require(balanceOf[from] >= amount, "BALANCE");

        uint256 fee = (amount * feeBps) / 10_000;
        uint256 received = amount - fee;

        balanceOf[from] -= amount;
        balanceOf[to] += received;
        totalSupply -= fee;

        emit Transfer(from, to, received);
        if (fee != 0) {
            emit Transfer(from, address(0), fee);
        }
    }
}
