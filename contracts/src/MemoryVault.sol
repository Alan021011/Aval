// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/// @title MemoryVault
/// @notice Almacenamiento remoto **no confiable** para la memoria cifrada de un usuario y de sus agentes.
/// Solo guarda bytes que ya vienen cifrados desde el dispositivo (AES-GCM con claves derivadas de la passkey):
/// el contrato, el relayer y cualquiera que lea la cadena ven ruido. Como vive en la cadena, la misma passkey en
/// otro dispositivo encuentra los mismos datos y los descifra, sin nada guardado en el navegador.
/// @dev Cada usuario tiene "casilleros" (`slot`): por ejemplo, uno para su memoria privada y uno por agente con el que
/// comparte una parte. Escribe el dueño, o un relayer con la firma EIP-712 del dueño (así el usuario no necesita gas).
contract MemoryVault is EIP712, Nonces {
    /// @notice Tamaño máximo de un casillero: alcanza para notas y preferencias, no para archivos.
    uint256 public constant MAX_BYTES = 4096;

    bytes32 private constant STORE_TYPEHASH =
        keccak256("Store(address owner,bytes32 slot,bytes32 dataHash,uint256 nonce,uint256 deadline)");

    mapping(address owner => mapping(bytes32 slot => bytes data)) private _data;

    event Stored(address indexed owner, bytes32 indexed slot, uint256 size);

    error TooLarge(uint256 size);
    error ExpiredSignature(uint256 deadline);
    error InvalidSignature();

    constructor() EIP712("Aval MemoryVault", "1") {}

    /// @notice Guarda (o borra, con `data` vacío) un casillero propio.
    function store(bytes32 slot, bytes calldata data) external {
        _store(msg.sender, slot, data);
    }

    /// @notice Guarda un casillero en nombre de `owner` con su firma EIP-712, para que un relayer pague el gas.
    /// @dev La firma cubre el hash exacto de los datos, el nonce y la fecha límite: no se puede cambiar el contenido
    /// ni reenviar la misma firma.
    function storeFor(address owner, bytes32 slot, bytes calldata data, uint256 deadline, bytes calldata signature)
        external
    {
        if (block.timestamp > deadline) revert ExpiredSignature(deadline);
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(STORE_TYPEHASH, owner, slot, keccak256(data), _useNonce(owner), deadline))
        );
        if (!SignatureChecker.isValidSignatureNow(owner, digest, signature)) revert InvalidSignature();
        _store(owner, slot, data);
    }

    /// @notice Los bytes cifrados de un casillero (vacío si no hay nada).
    function get(address owner, bytes32 slot) external view returns (bytes memory) {
        return _data[owner][slot];
    }

    function _store(address owner, bytes32 slot, bytes calldata data) private {
        if (data.length > MAX_BYTES) revert TooLarge(data.length);
        _data[owner][slot] = data;
        emit Stored(owner, slot, data.length);
    }
}
