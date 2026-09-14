import { ponder } from "ponder:registry";
import { createManifestStore } from "@enspack/core";
import { publicResolverAbi } from "./abi.js";
import { ingestContenthashChanged, ingestTextChanged } from "./ingest.js";
import { ponderStoreRepo } from "./ponder-store.js";

const store = createManifestStore();

ponder.on("PublicResolver:ContenthashChanged", async ({ event, context }) => {
  await ingestContenthashChanged({
    store,
    repo: ponderStoreRepo(context.db),
    chain: context.chain.name,
    node: event.args.node,
    hash: event.args.hash,
    block: Number(event.block.number),
    txHash: event.transaction.hash,
  });
});

ponder.on("PublicResolver:TextChanged", async ({ event, context }) => {
  await ingestTextChanged({
    store,
    repo: ponderStoreRepo(context.db),
    chain: context.chain.name,
    node: event.args.node,
    key: event.args.key,
    value: event.args.value,
    resolver: event.log.address,
    block: Number(event.block.number),
    txHash: event.transaction.hash,
    readContenthash: (address, node) =>
      context.client.readContract({
        address,
        abi: publicResolverAbi,
        functionName: "contenthash",
        args: [node],
      }),
  });
});
