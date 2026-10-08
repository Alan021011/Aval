// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {PasskeyRegistry} from "./PasskeyRegistry.sol";

/// @title AgentPermit
/// @notice Permisos acotados que un usuario le da a un agente de IA para gastar sus tokens: monto máximo por
/// gasto, total, caducidad y destinatarios permitidos. Los gastos sobre un umbral quedan pendientes hasta que
/// el usuario los aprueba con su passkey, verificada onchain con el precompile P256 de Monad.
/// @dev Los fondos se quedan en la cuenta del usuario: el contrato los mueve con `transferFrom`, así que el
/// usuario debe autorizar a este contrato en el token (con `approve` o con una firma ERC-2612).
/// Cada gasto deja un recibo (`paidAmount`) que sirve para filtrar la reputación por clientes que pagaron.
contract AgentPermit is EIP712, Nonces, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    /// Límites que el usuario fija al crear un permiso.
    struct Terms {
        address agent; // dirección con la que firma el agente
        uint256 agentId; // ID del agente en ERC-8004 (informativo, 0 si no tiene)
        address token;
        uint128 maxPerSpend;
        uint128 maxTotal;
        uint128 approvalThreshold; // gastos mayores a esto necesitan la passkey; type(uint128).max = nunca
        uint64 expiresAt;
    }

    struct Permit {
        address owner;
        bool revoked;
        bool anyRecipient;
        uint128 spent;
        Terms terms;
    }

    enum RequestStatus {
        None,
        Pending,
        Executed
    }

    struct SpendRequest {
        uint256 permitId;
        address to;
        uint128 amount;
        RequestStatus status;
        bytes32 ref;
    }

    bytes32 private constant GRANT_TYPEHASH = keccak256(
        "Grant(address owner,address agent,uint256 agentId,address token,uint128 maxPerSpend,uint128 maxTotal,uint128 approvalThreshold,uint64 expiresAt,bytes32 recipientsHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant REVOKE_TYPEHASH = keccak256("Revoke(uint256 permitId,uint256 nonce,uint256 deadline)");
    bytes32 private constant APPROVE_TYPEHASH =
        keccak256("ApproveSpend(uint256 requestId,uint256 permitId,address to,uint128 amount,bytes32 ref)");

    PasskeyRegistry public immutable passkeys;

    uint256 public nextPermitId = 1;
    uint256 public nextRequestId = 1;

    mapping(uint256 permitId => Permit) private _permits;
    mapping(uint256 permitId => mapping(address recipient => bool)) private _allowedRecipient;
    mapping(uint256 requestId => SpendRequest) private _requests;
    mapping(address payee => mapping(address client => uint256)) private _paid;
    mapping(address payee => EnumerableSet.AddressSet) private _payers;
    mapping(address payee => mapping(address payer => address owner)) private _payerOwner;

    event PermitGranted(
        uint256 indexed permitId, address indexed owner, address indexed agent, uint256 agentId, Terms terms
    );
    event PermitRevoked(uint256 indexed permitId);
    event Spent(
        uint256 indexed permitId,
        address indexed agent,
        address indexed to,
        address owner,
        address token,
        uint256 amount,
        bytes32 ref,
        uint256 requestId
    );
    event SpendRequested(
        uint256 indexed requestId,
        uint256 indexed permitId,
        address indexed owner,
        address to,
        uint256 amount,
        bytes32 ref,
        bytes32 challenge
    );

    error InvalidTerms();
    error ExpiredSignature(uint256 deadline);
    error InvalidSignature();
    error NotOwner();
    error NotAgent();
    error PermitInactive(uint256 permitId);
    error RecipientNotAllowed(address to);
    error ExceedsPerSpendLimit(uint256 amount, uint256 limit);
    error ExceedsTotalLimit(uint256 amount, uint256 remaining);
    error NeedsApproval(uint256 amount, uint256 threshold);
    error RequestNotPending(uint256 requestId);
    error InvalidApproval();

    constructor(PasskeyRegistry passkeys_) EIP712("Aval AgentPermit", "1") {
        passkeys = passkeys_;
    }

    // ---------------------------------------------------------------- permisos

    /// @notice Crea un permiso para un agente. `recipients` vacío permite pagar a cualquiera.
    function grant(Terms calldata terms, address[] calldata recipients) external returns (uint256 permitId) {
        return _grant(msg.sender, terms, recipients);
    }

    /// @notice Crea un permiso con la firma EIP-712 del usuario, para que un relayer pague el gas.
    function grantBySig(
        address owner,
        Terms calldata terms,
        address[] calldata recipients,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256 permitId) {
        if (block.timestamp > deadline) revert ExpiredSignature(deadline);
        // `Terms` solo tiene campos estáticos, así que codificar el struct equivale a codificar sus campos en
        // el orden del typehash.
        bytes32 structHash = keccak256(
            abi.encode(GRANT_TYPEHASH, owner, terms, keccak256(abi.encodePacked(recipients)), _useNonce(owner), deadline)
        );
        _checkSignature(owner, structHash, signature);
        return _grant(owner, terms, recipients);
    }

    /// @notice El usuario revoca el permiso. Los gastos pendientes ya no se podrán aprobar.
    function revoke(uint256 permitId) external {
        if (_permits[permitId].owner != msg.sender) revert NotOwner();
        _revoke(permitId);
    }

    /// @notice Revoca con la firma del usuario, para que un relayer pague el gas.
    function revokeBySig(uint256 permitId, uint256 deadline, bytes calldata signature) external {
        if (block.timestamp > deadline) revert ExpiredSignature(deadline);
        address owner = _permits[permitId].owner;
        if (owner == address(0)) revert PermitInactive(permitId);
        _checkSignature(owner, keccak256(abi.encode(REVOKE_TYPEHASH, permitId, _useNonce(owner), deadline)), signature);
        _revoke(permitId);
    }

    // ---------------------------------------------------------------- gastos

    /// @notice El agente gasta dentro de los límites. Si el monto supera el umbral, debe usar `requestSpend`.
    function spend(uint256 permitId, address to, uint128 amount, bytes32 ref) external nonReentrant {
        Permit storage permit = _permits[permitId];
        if (msg.sender != permit.terms.agent) revert NotAgent();
        _checkLimits(permitId, permit, to, amount);
        if (amount > permit.terms.approvalThreshold) revert NeedsApproval(amount, permit.terms.approvalThreshold);
        _execute(permitId, permit, to, amount, ref, 0);
    }

    /// @notice El agente pide un gasto que supera el umbral. Queda pendiente hasta que el usuario lo aprueba.
    /// @return requestId Identificador del pedido. El usuario firma `approvalChallenge(requestId)` con su passkey.
    function requestSpend(uint256 permitId, address to, uint128 amount, bytes32 ref)
        external
        returns (uint256 requestId)
    {
        Permit storage permit = _permits[permitId];
        if (msg.sender != permit.terms.agent) revert NotAgent();
        _checkLimits(permitId, permit, to, amount);

        requestId = nextRequestId++;
        _requests[requestId] = SpendRequest(permitId, to, amount, RequestStatus.Pending, ref);
        emit SpendRequested(requestId, permitId, permit.owner, to, amount, ref, approvalChallenge(requestId));
    }

    /// @notice Ejecuta un gasto pendiente con la aprobación de la passkey del usuario. Cualquiera puede
    /// enviarla (por ejemplo, un relayer); lo que cuenta es la firma de la passkey.
    function approveSpend(uint256 requestId, WebAuthn.WebAuthnAuth calldata auth) external nonReentrant {
        SpendRequest storage request = _requests[requestId];
        if (request.status != RequestStatus.Pending) revert RequestNotPending(requestId);

        Permit storage permit = _permits[request.permitId];
        bytes memory challenge = abi.encodePacked(approvalChallenge(requestId));
        if (!passkeys.verifyApproval(permit.owner, challenge, auth)) revert InvalidApproval();

        // Los límites se revisan otra vez: el permiso pudo revocarse, vencer o gastarse mientras tanto.
        _checkLimits(request.permitId, permit, request.to, request.amount);
        request.status = RequestStatus.Executed;
        _execute(request.permitId, permit, request.to, request.amount, request.ref, requestId);
    }

    // ---------------------------------------------------------------- consultas

    /// @notice Lo que el usuario firma con su passkey para aprobar un pedido. Es un hash EIP-712, así que queda
    /// atado a esta red, a este contrato y a los datos exactos del gasto.
    function approvalChallenge(uint256 requestId) public view returns (bytes32) {
        SpendRequest storage r = _requests[requestId];
        return _hashTypedDataV4(keccak256(abi.encode(APPROVE_TYPEHASH, requestId, r.permitId, r.to, r.amount, r.ref)));
    }

    function getPermit(uint256 permitId) external view returns (Permit memory) {
        return _permits[permitId];
    }

    function getRequest(uint256 requestId) external view returns (SpendRequest memory) {
        return _requests[requestId];
    }

    /// @notice Cuánto queda por gastar del total del permiso (0 si está revocado o vencido).
    function remaining(uint256 permitId) external view returns (uint256) {
        Permit storage permit = _permits[permitId];
        if (!_isActive(permit)) return 0;
        return permit.terms.maxTotal - permit.spent;
    }

    function isAllowedRecipient(uint256 permitId, address to) public view returns (bool) {
        return _permits[permitId].anyRecipient || _allowedRecipient[permitId][to];
    }

    /// @notice Recibo acumulado: cuánto le pagó `client` a `payee` a través de permisos. Cuenta tanto para el
    /// dueño del permiso como para su agente.
    function paidAmount(address payee, address client) external view returns (uint256) {
        return _paid[payee][client];
    }

    /// @notice Cuántas cuentas distintas le han pagado a `payee`.
    function payerCount(address payee) external view returns (uint256) {
        return _payers[payee].length();
    }

    /// @notice Página de cuentas que le han pagado a `payee`, en orden de primer pago.
    function payers(address payee, uint256 offset, uint256 limit) external view returns (address[] memory page) {
        return _payers[payee].values(offset, offset + limit);
    }

    /// @notice El usuario (dueño del permiso) detrás de un pagador: él mismo si pagó como dueño, o el dueño del
    /// permiso si quien pagó fue su agente. Sirve para verificar al humano aunque la reseña la deje el agente.
    /// @dev Si una misma dirección de agente pagó a `payee` para varios dueños, queda el último.
    function payerOwner(address payee, address payer) external view returns (address) {
        return _payerOwner[payee][payer];
    }

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ---------------------------------------------------------------- internas

    function _grant(address owner, Terms calldata terms, address[] calldata recipients)
        private
        returns (uint256 permitId)
    {
        if (
            terms.agent == address(0) || terms.agent == owner || terms.token == address(0) || terms.maxPerSpend == 0
                || terms.maxPerSpend > terms.maxTotal || terms.expiresAt <= block.timestamp
        ) revert InvalidTerms();

        permitId = nextPermitId++;
        Permit storage permit = _permits[permitId];
        permit.owner = owner;
        permit.anyRecipient = recipients.length == 0;
        permit.terms = terms;
        for (uint256 i; i < recipients.length; ++i) {
            _allowedRecipient[permitId][recipients[i]] = true;
        }
        emit PermitGranted(permitId, owner, terms.agent, terms.agentId, terms);
    }

    function _revoke(uint256 permitId) private {
        _permits[permitId].revoked = true;
        emit PermitRevoked(permitId);
    }

    function _checkLimits(uint256 permitId, Permit storage permit, address to, uint128 amount) private view {
        if (!_isActive(permit)) revert PermitInactive(permitId);
        if (!isAllowedRecipient(permitId, to)) revert RecipientNotAllowed(to);
        if (amount > permit.terms.maxPerSpend) revert ExceedsPerSpendLimit(amount, permit.terms.maxPerSpend);
        uint256 left = permit.terms.maxTotal - permit.spent;
        if (amount > left) revert ExceedsTotalLimit(amount, left);
    }

    function _execute(uint256 permitId, Permit storage permit, address to, uint128 amount, bytes32 ref, uint256 requestId)
        private
    {
        permit.spent += amount;
        _paid[to][permit.owner] += amount;
        _paid[to][permit.terms.agent] += amount;
        _payers[to].add(permit.owner);
        _payers[to].add(permit.terms.agent);
        _payerOwner[to][permit.owner] = permit.owner;
        _payerOwner[to][permit.terms.agent] = permit.owner;
        emit Spent(permitId, permit.terms.agent, to, permit.owner, permit.terms.token, amount, ref, requestId);
        IERC20(permit.terms.token).safeTransferFrom(permit.owner, to, amount);
    }

    function _isActive(Permit storage permit) private view returns (bool) {
        return permit.owner != address(0) && !permit.revoked && block.timestamp < permit.terms.expiresAt;
    }

    function _checkSignature(address signer, bytes32 structHash, bytes calldata signature) private view {
        if (!SignatureChecker.isValidSignatureNow(signer, _hashTypedDataV4(structHash), signature)) {
            revert InvalidSignature();
        }
    }
}
