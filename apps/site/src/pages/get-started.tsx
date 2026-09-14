import { CommandBlock } from "../components/command-block.js";
import { ExternalLink } from "../components/external-link.js";
import { config } from "../lib/config.js";
import { useDocumentTitle } from "../lib/use-document-title.js";
import "../styles/pages/get-started.css";

const EXAMPLE = "qwen--qwen2-5-7b-instruct.mirrors.enspack.eth";
const GET_CMD = `enspack get ${EXAMPLE}`;
const ADD_CMD = `enspack add ${EXAMPLE}`;
const PUBLISH_CMD = "enspack publish --from-hf <org/repo> --publisher <name> --version <semver>";

export function GetStartedPage() {
  useDocumentTitle("Get started");
  const claimHref = `${config.registrarUrl}/`;
  const specHref = `${config.repoUrl}/blob/master/SPEC.md`;

  return (
    <article className="get-started-page">
      <h1>Get started</h1>
      <p className="get-started-lead">
        An ENS name points at a content-addressed manifest. Hosts are never trusted.
      </p>
      <ul>
        <li>The CLI checks every file by SHA-256.</li>
        <li>Bytes come from BitTorrent plus HF webseeds.</li>
      </ul>

      <section aria-labelledby="gs-install">
        <h2 id="gs-install">Install</h2>
        <p>
          Requires Node 22+ and <code>aria2c</code> on <code>PATH</code> (the downloader the CLI
          shells out to).
        </p>
        <CommandBlock command="npm i -g @enspack/cli" />
      </section>

      <section aria-labelledby="gs-fetch">
        <h2 id="gs-fetch">Fetch a model</h2>
        <p>Resolves the name and verifies every file before writing the HF cache.</p>
        <ul>
          <li>Download the manifest CID.</li>
          <li>Fetch the torrent and webseeds.</li>
          <li>Check each file by SHA-256.</li>
        </ul>
        <CommandBlock command={GET_CMD} />
        {config.chain !== "mainnet" && (
          <>
            <p>
              This catalog is on the {config.chain} testnet. Pass{" "}
              <code>--chain {config.chain}</code> so the CLI reads the same names.
            </p>
            <CommandBlock command={`${GET_CMD} --chain ${config.chain}`} />
          </>
        )}
      </section>

      <section aria-labelledby="gs-pin">
        <h2 id="gs-pin">Pin in a project</h2>
        <p>Lock a name into a project so later installs stay content-addressed.</p>
        <ul>
          <li>
            <code>enspack add</code> resolves a name and appends it to <code>enspack.lock</code>.
          </li>
          <li>
            <code>enspack install</code> reads the lockfile, requires each CID to match, then
            downloads and verifies.
          </li>
          <li>
            A CID mismatch exits 3 (unless you pass <code>--update</code>).
          </li>
        </ul>
        <CommandBlock command={ADD_CMD} />
        <CommandBlock command="enspack install" />
      </section>

      <section aria-labelledby="gs-publish">
        <h2 id="gs-publish">Publish</h2>
        <p>
          Build a manifest from a Hugging Face repo and write the version + model names on-chain.
        </p>
        <ul>
          <li>ENSv1 (SPEC §8): 3 transactions for a new model, 2 for a new version.</li>
          <li>
            ENSv2 (Sepolia&apos;s default): 4 txs for a new model, 2 for a new version, plus
            first-time publisher setup.
          </li>
        </ul>
        <CommandBlock command={PUBLISH_CMD} />
      </section>

      <section aria-labelledby="gs-claim">
        <h2 id="gs-claim">Claim a publisher name</h2>
        <p>
          Proof of Hugging Face org or user control binds a label under <code>enspack.eth</code> to
          your wallet (SPEC §7).
        </p>
        <ul>
          <li>
            Request a claim: <code>POST /v1/claims</code> with your HF namespace and address; you
            get a <code>claimId</code> and a challenge.
          </li>
          <li>
            Commit <code>enspack-verify.txt</code> to a public repo under that namespace, containing
            exactly the challenge and address.
          </li>
          <li>
            Sign the challenge with the same address (EIP-191 <code>personal_sign</code>).
          </li>
          <li>
            Submit <code>POST /v1/claims/{"{claimId}"}/verify</code> with the repo and signature.
            The registrar issues the name and stores the attestation permanently.
          </li>
        </ul>
        <ExternalLink href={claimHref} className="btn-primary">
          Claim &lt;you&gt;.enspack.eth
        </ExternalLink>
        <p className="get-started-links">
          <ExternalLink href={specHref}>SPEC.md</ExternalLink>
          <ExternalLink href={config.repoUrl}>GitHub</ExternalLink>
        </p>
      </section>
    </article>
  );
}
