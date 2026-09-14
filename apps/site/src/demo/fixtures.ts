import attestationJeff from "../../test/fixtures/attestation-jeff.json";
import nameJeff from "../../test/fixtures/name-jeff.json";
import nameLlama from "../../test/fixtures/name-llama.json";
import nameQwen from "../../test/fixtures/name-qwen.json";
import names from "../../test/fixtures/names.json";
import publishers from "../../test/fixtures/publishers.json";
import violations from "../../test/fixtures/violations.json";
import type {
  Attestation,
  NameDetail,
  NamesPage,
  PublishersPage,
  ViolationsPage,
} from "../lib/api.js";
import type { FixtureData } from "../lib/client.js";

const details = [nameQwen, nameLlama, nameJeff] as unknown as NameDetail[];

/** Recorded indexer responses. Shared by unit tests and `VITE_DATA_SOURCE=demo`. */
export const demoFixtures: FixtureData = {
  names: names as NamesPage,
  details: Object.fromEntries(details.map((d) => [d.model, d])),
  publishers: publishers as PublishersPage,
  violations: violations as ViolationsPage,
  attestations: { jeff: attestationJeff as Attestation },
};
