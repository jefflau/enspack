import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020.js";

const root = new URL("..", import.meta.url).pathname;
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(
  JSON.parse(readFileSync(join(root, "schema/enspack.schema.json"), "utf8")),
);
ajv.compile(JSON.parse(readFileSync(join(root, "schema/enspack.lock.schema.json"), "utf8")));

let failed = false;
for (const f of readdirSync(join(root, "examples")).filter((f) => f.endsWith(".enspack.json"))) {
  const m = JSON.parse(readFileSync(join(root, "examples", f), "utf8"));
  const ok = validate(m);
  const sizeOk = m.files.reduce((a, x) => a + x.size, 0) === m.totalSize;
  const magnetOk = m.distribution.magnet.includes(`urn:btih:${m.distribution.infohash}`);
  if (!ok || !sizeOk || !magnetOk) {
    failed = true;
    console.error(
      `FAIL ${f}`,
      validate.errors ?? "",
      sizeOk ? "" : "totalSize mismatch",
      magnetOk ? "" : "magnet/infohash mismatch",
    );
  } else {
    console.log(`ok   ${f}`);
  }
}
process.exit(failed ? 1 : 0);
