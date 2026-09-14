/** Minimal ENS ABIs used by the WP-02 read path (SPEC §2 / §4). */

export const ensRegistryAbi = [
  {
    type: "function",
    name: "resolver",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "setSubnodeRecord",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "label", type: "bytes32" },
      { name: "owner", type: "address" },
      { name: "resolver", type: "address" },
      { name: "ttl", type: "uint64" },
    ],
    outputs: [],
  },
] as const;

export const contenthashResolverAbi = [
  {
    type: "function",
    name: "contenthash",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes" }],
  },
] as const;

export const textResolverAbi = [
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

export const publicResolverWriteAbi = [
  {
    type: "function",
    name: "setContenthash",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "hash", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "multicall",
    stateMutability: "nonpayable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
] as const;

export const universalResolverAbi = [
  {
    type: "function",
    name: "resolve",
    stateMutability: "view",
    inputs: [
      { name: "name", type: "bytes" },
      { name: "data", type: "bytes" },
    ],
    outputs: [
      { name: "result", type: "bytes" },
      { name: "resolver", type: "address" },
    ],
  },
  {
    type: "function",
    name: "resolveWithGateways",
    stateMutability: "view",
    inputs: [
      { name: "name", type: "bytes" },
      { name: "data", type: "bytes" },
      { name: "gateways", type: "string[]" },
    ],
    outputs: [
      { name: "result", type: "bytes" },
      { name: "resolver", type: "address" },
    ],
  },
  {
    type: "function",
    name: "findResolver",
    stateMutability: "view",
    inputs: [{ name: "name", type: "bytes" }],
    outputs: [
      { name: "resolver", type: "address" },
      { name: "node", type: "bytes32" },
      { name: "offset", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ResolverNotFound",
    inputs: [{ name: "name", type: "bytes" }],
  },
  {
    type: "error",
    name: "ResolverNotContract",
    inputs: [
      { name: "name", type: "bytes" },
      { name: "resolver", type: "address" },
    ],
  },
  {
    type: "error",
    name: "ResolverError",
    inputs: [{ name: "errorData", type: "bytes" }],
  },
  {
    type: "error",
    name: "UnsupportedResolverProfile",
    inputs: [{ name: "selector", type: "bytes4" }],
  },
  {
    type: "error",
    name: "HttpError",
    inputs: [
      { name: "status", type: "uint16" },
      { name: "message", type: "string" },
    ],
  },
] as const;
