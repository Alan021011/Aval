// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/// @title PasskeyRegistry
/// @notice Liga la cuenta de un usuario (la EOA que Mera deriva de su passkey) con la clave pública P256
/// de esa misma passkey. Con la clave guardada onchain, cualquier contrato puede verificar que el usuario
/// aprobó una acción con su huella, y la clave se recupera en un dispositivo nuevo sin estado local.
/// @dev La verificación usa el precompile P256 de Monad (0x0100) a través de OpenZeppelin, que cae a una
/// implementación en Solidity si el precompile no existe (por ejemplo, en tests locales).
contract PasskeyRegistry is EIP712, Nonces {
    struct Key {
        bytes32 x;
        bytes32 y;
    }

    bytes32 private constant REGISTER_TYPEHASH =
        keccak256("Register(address owner,bytes32 x,bytes32 y,uint256 nonce,uint256 deadline)");

    mapping(address owner => Key) private _keys;

    event PasskeyRegistered(address indexed owner, bytes32 x, bytes32 y);

    error InvalidPublicKey();
    error ExpiredSignature(uint256 deadline);
    error InvalidSignature();

    constructor() EIP712("Aval PasskeyRegistry", "1") {}

    /// @notice Registra o rota la clave P256 de quien llama.
    function register(bytes32 x, bytes32 y) external {
        _register(msg.sender, x, y);
    }

    /// @notice Registra la clave en nombre de `owner` con su firma EIP-712, para que un relayer pague el gas.
    /// @dev El nonce impide reenviar la misma firma; `deadline` limita cuánto tiempo sirve.
    function registerFor(address owner, bytes32 x, bytes32 y, uint256 deadline, bytes calldata signature) external {
        if (block.timestamp > deadline) revert ExpiredSignature(deadline);
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(REGISTER_TYPEHASH, owner, x, y, _useNonce(owner), deadline))
        );
        if (!SignatureChecker.isValidSignatureNow(owner, digest, signature)) revert InvalidSignature();
        _register(owner, x, y);
    }

    /// @notice Devuelve la clave P256 registrada de `owner` (ceros si no tiene).
    function keyOf(address owner) external view returns (bytes32 x, bytes32 y) {
        Key storage key = _keys[owner];
        return (key.x, key.y);
    }

    function hasKey(address owner) public view returns (bool) {
        return _keys[owner].x != bytes32(0) || _keys[owner].y != bytes32(0);
    }

    /// @notice Comprueba que `owner` aprobó `challenge` con su passkey, exigiendo presencia y verificación
    /// del usuario (huella, rostro o PIN).
    /// @dev Requiere `s` en la mitad baja de la curva: el cliente debe normalizar la firma de WebAuthn.
    function verifyApproval(address owner, bytes memory challenge, WebAuthn.WebAuthnAuth memory auth)
        public
        view
        returns (bool)
    {
        Key storage key = _keys[owner];
        if (key.x == bytes32(0) && key.y == bytes32(0)) return false;
        return WebAuthn.verify(challenge, auth, key.x, key.y, true);
    }

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _register(address owner, bytes32 x, bytes32 y) private {
        if (!P256.isValidPublicKey(x, y)) revert InvalidPublicKey();
        _keys[owner] = Key(x, y);
        emit PasskeyRegistered(owner, x, y);
    }
}
