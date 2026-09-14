import type { PublishCall, PublishResult } from "@enspack/core";

function gasOf(call: PublishCall): string {
  return call.gas !== undefined ? ` gas=${call.gas.toString()}` : "";
}

/**
 * SPEC §8 / MVP.md WP-04: human-readable dry-run plan (calldata descriptions + gas).
 */
export function formatPublishPlan(result: PublishResult): string {
  const lines = [
    `publish ${result.name}`,
    `model ${result.model} cid=${result.cid}`,
    `created model=${result.created.model} version=${result.created.version}`,
  ];
  for (const call of result.calls) {
    lines.push(`  ${call.description}${gasOf(call)} to=${call.to}`);
  }
  if (result.txs.length > 0) {
    lines.push(`txs ${result.txs.join(" ")}`);
  }
  return lines.join("\n");
}
