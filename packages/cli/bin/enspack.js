#!/usr/bin/env node
const major = Number(process.versions.node.split(".")[0]);
if (!Number.isFinite(major) || major < 22) {
  process.stderr.write(
    `enspack requires Node 22 or newer (running ${process.version}); global fetch and other APIs are missing.\n`,
  );
  process.exit(1);
}

const { createCli, createDefaultDeps } = await import("../dist/index.js");

const { run } = createCli({
  deps: createDefaultDeps({
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    cwd: process.cwd(),
  }),
});

const code = await run(process.argv);
process.exit(code);
