#!/usr/bin/env node
process.argv.splice(2, 0, "get");
await import("./enspack.js");
