// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title TestUSD
/// @notice Dólar de prueba para testnet, con 6 decimales como USDC. Soporta ERC-2612 (`permit`), así que el
/// usuario autoriza gastos con una firma y un relayer paga el gas. Se paga en este token y no en MON para no
/// chocar con la reserva de balance de Monad.
contract TestUSD is ERC20, ERC20Permit {
    uint256 public constant FAUCET_LIMIT = 1_000e6;

    error FaucetLimitExceeded(uint256 limit);

    constructor() ERC20("Aval Test USD", "tUSD") ERC20Permit("Aval Test USD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Cualquiera puede pedir hasta 1.000 tUSD por llamada. Solo para testnet.
    function faucet(address to, uint256 amount) external {
        if (amount > FAUCET_LIMIT) revert FaucetLimitExceeded(FAUCET_LIMIT);
        _mint(to, amount);
    }
}
