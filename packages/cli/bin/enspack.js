#!/usr/bin/env node
import { createCli, createDefaultDeps } from "../dist/index.js";

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
