import { Command, CommanderError } from "commander";
import { registerAdd } from "./commands/add.js";
import { registerGet } from "./commands/get.js";
import { registerInspect } from "./commands/inspect.js";
import { registerInstall } from "./commands/install.js";
import { registerPublish } from "./commands/publish.js";
import { registerSeed } from "./commands/seed.js";
import { registerUpdate } from "./commands/update.js";
import { registerVerify } from "./commands/verify.js";
import { registerVersions } from "./commands/versions.js";
import { applyEnsVersionFlag } from "./ens.js";
import { exitCodeFor } from "./io.js";
import type { CliDeps } from "./types.js";

export interface CreateCliOpts {
  deps: CliDeps;
}

function normalizeArgv(argv: string[]): string[] {
  const exe = argv[1] ?? "";
  const base = exe.split(/[/\\]/).pop() ?? exe;
  if (base === "ensget" || base === "ensget.js") {
    return [argv[0] ?? "node", "enspack", "get", ...argv.slice(2)];
  }
  return argv;
}

/**
 * MVP.md WP-08: CLI factory. Tests inject fakes via `deps`; the binary wires real ones.
 */
export function createCli(opts: CreateCliOpts): { run: (argv?: string[]) => Promise<number> } {
  const { deps } = opts;

  const run = async (rawArgv: string[] = process.argv): Promise<number> => {
    const argv = normalizeArgv(rawArgv);
    const program = new Command();
    program.name("enspack");
    program.description("Named, verifiable, host-independent distribution of model weights");
    program.showHelpAfterError(false);
    program.exitOverride();
    program.configureOutput({
      writeOut: (str) => {
        deps.stderr.write(str);
      },
      writeErr: (str) => {
        deps.stderr.write(str);
      },
    });

    registerGet(program, deps);
    registerInspect(program, deps);
    registerVersions(program, deps);
    registerVerify(program, deps);
    registerAdd(program, deps);
    registerInstall(program, deps);
    registerUpdate(program, deps);
    registerPublish(program, deps);
    registerSeed(program, deps);

    program.hook("preAction", (_thisCommand, actionCommand) => {
      const opts = actionCommand.opts<{ ensVersion?: string }>();
      applyEnsVersionFlag(deps.env, opts.ensVersion);
    });

    try {
      await program.parseAsync(argv, { from: "node" });
      return 0;
    } catch (err) {
      if (err instanceof CommanderError) {
        if (
          err.code === "commander.helpDisplayed" ||
          err.code === "commander.help" ||
          err.code === "commander.version"
        ) {
          return 0;
        }
        deps.stderr.write(err.message.endsWith("\n") ? err.message : `${err.message}\n`);
        return err.exitCode === 0 ? 0 : 1;
      }
      return exitCodeFor(err, deps.stderr, deps.env);
    }
  };

  return { run };
}
