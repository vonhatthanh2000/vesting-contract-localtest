// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @notice Test BEP-20 with EIP-2612 permit. NOT for production.
contract MockUSDT is ERC20, ERC20Permit {
    uint8 private immutable _decimals;

    constructor(uint8 decimals_) ERC20("Mock USDT", "USDT") ERC20Permit("Mock USDT") {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
