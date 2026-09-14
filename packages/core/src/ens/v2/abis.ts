import { parseAbi } from "viem";

/** ENSv2 UniversalResolverV2 + ENSIP-10 (issue #17); `resolve` returns `(bytes result, address resolver)`. */
export const universalResolverV2Abi = parseAbi([
  "function ROOT_REGISTRY() view returns (address)",
  "function findResolver(bytes name) view returns (address resolver, bytes32 node, uint256 offset)",
  "function findExactRegistry(bytes name) view returns (address)",
  "function findParentRegistry(bytes name) view returns (address)",
  "function findRegistries(bytes name) view returns (address[])",
  "function findOwner(bytes name) view returns (address)",
  "function findCanonicalName(address registry) view returns (bytes)",
  "function resolve(bytes name, bytes data) view returns (bytes result, address resolver)",
  "error ResolverNotFound(bytes name)",
  "error ResolverNotContract(bytes name, address resolver)",
  "error ResolverError(bytes errorData)",
  "error UnsupportedResolverProfile(bytes4 selector)",
  "error HttpError(uint16 status, string message)",
]);

/** ENSv2 PermissionedRegistry / UserRegistry surface (issue #17). */
export const registryV2Abi = parseAbi([
  "function initialize(address rootAccount, uint256 roleBitmap)",
  "function getSubregistry(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
  "function getParent() view returns (address parent, string label)",
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256 tokenId)",
  "function setSubregistry(uint256 anyId, address registry)",
  "function setResolver(uint256 anyId, address resolver)",
  "function setParent(address parent, string label)",
  "function getExpiry(uint256 anyId) view returns (uint64)",
  "function getOwner(uint256 anyId) view returns (address)",
  "function getStatus(uint256 anyId) view returns (uint8)",
  "function getTokenId(uint256 anyId) view returns (uint256)",
  "function getResource(uint256 anyId) view returns (uint256)",
  "function grantRoles(uint256 anyId, uint256 roleBitmap, address account) returns (bool)",
  "function grantRootRoles(uint256 roleBitmap, address account) returns (bool)",
  "function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)",
  "function hasRootRoles(uint256 roleBitmap, address account) view returns (bool)",
  "function roles(uint256 resource, address account) view returns (uint256)",
]);

/** ENSv2 PermissionedResolver proxy (issue #17); PublicResolverV2 is not used for fresh v2 names. */
export const permissionedResolverAbi = parseAbi([
  "function initialize(address admin, uint256 roleBitmap, bytes[] setters)",
  "function setText(bytes32 node, string key, string value)",
  "function setContenthash(bytes32 node, bytes hash)",
  "function text(bytes32 node, string key) view returns (string)",
  "function contenthash(bytes32 node) view returns (bytes)",
  "function multicall(bytes[] data) returns (bytes[] results)",
  "function authorizeNameRoles(bytes toName, uint256 roleBitmap, address account, bool grant) returns (bool)",
  "function hasRootRoles(uint256 roleBitmap, address account) view returns (bool)",
]);

/** VerifiableFactory (issue #17); event arg `proxyAddress` matches IVerifiableFactory.sol. */
export const verifiableFactoryAbi = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address proxy)",
  "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
]);
