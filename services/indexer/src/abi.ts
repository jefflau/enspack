/** PublicResolver events the indexer subscribes to (SPEC §2.3). */

export const publicResolverAbi = [
  {
    type: "event",
    name: "TextChanged",
    inputs: [
      { name: "node", type: "bytes32", indexed: true },
      { name: "indexedKey", type: "string", indexed: true },
      { name: "key", type: "string", indexed: false },
      { name: "value", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ContenthashChanged",
    inputs: [
      { name: "node", type: "bytes32", indexed: true },
      { name: "hash", type: "bytes", indexed: false },
    ],
  },
  {
    type: "function",
    name: "contenthash",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes" }],
  },
] as const;
