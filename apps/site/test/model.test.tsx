import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ensAppUrl } from "../src/lib/format.js";
import { ModelPage } from "../src/pages/model.js";
import { renderAt } from "./helpers.js";

afterEach(() => {
  cleanup();
});

const QWEN = "qwen--qwen2-5-7b-instruct.mirrors.enspack.eth";
const QWEN_VERSION = "v1-0-0.qwen--qwen2-5-7b-instruct.mirrors.enspack.eth";
const JEFF = "tiny-random.jeff.enspack.eth";
const JEFF_OLD = "v0-1-0.tiny-random.jeff.enspack.eth";

const QWEN_PATHS = [
  ".gitattributes",
  "LICENSE",
  "README.md",
  "config.json",
  "generation_config.json",
  "merges.txt",
  "model-00001-of-00004.safetensors",
  "model-00002-of-00004.safetensors",
  "model-00003-of-00004.safetensors",
  "model-00004-of-00004.safetensors",
  "model.safetensors.index.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
] as const;

const QWEN_SHA = "11ad7efa24975ee4b0c3c3a38ed18737f0658a5f75a0a96787b576a78a023361";
const QWEN_INFOHASH = "136cb94838da83a906263ec23d03dce95d736c64";
const QWEN_MAGNET =
  "magnet:?xt=urn:btih:136cb94838da83a906263ec23d03dce95d736c64&dn=Qwen2.5-7B-Instruct";
const QWEN_WEBSEEDS = [
  "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct/resolve/a09a35458c702b33eeacc393d103063234e8bc28/",
  "https://huggingbay.xyz/api/downloads/hf-model-qwen-qwen2-5-7b-instruct/",
] as const;

function renderName(name: string) {
  return renderAt(`/name/${encodeURIComponent(name)}`, <ModelPage />, {
    routePattern: "/name/:name",
  });
}

function filePaths(): string[] {
  const table = screen.getByRole("table", { name: "Files" });
  const tbody = table.querySelector("tbody");
  if (tbody === null) throw new Error("expected files tbody");
  return [...tbody.querySelectorAll("tr")].map((row) => {
    const path = within(row).getAllByRole("cell")[0]?.textContent?.trim() ?? "";
    return path;
  });
}

describe("ModelPage", () => {
  it("renders the Qwen trust chain, files, and lock entry", async () => {
    renderName(QWEN);

    expect(await screen.findByRole("heading", { name: "Qwen2.5-7B-Instruct" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Indexed from sepolia. Verification shown here is the indexer's; the CLI re-verifies every file locally.",
      ),
    ).toBeInTheDocument();

    for (const path of QWEN_PATHS) {
      expect(screen.getByText(path)).toBeInTheDocument();
    }
    expect(QWEN_PATHS).toHaveLength(14);
    expect(screen.getByText(QWEN_SHA)).toBeInTheDocument();
    expect(screen.getByText(QWEN_INFOHASH)).toBeInTheDocument();

    const magnet = document.querySelector(`a[href="${QWEN_MAGNET}"]`);
    expect(magnet).not.toBeNull();

    for (const url of QWEN_WEBSEEDS) {
      expect(screen.getByRole("link", { name: url })).toHaveAttribute("href", url);
    }

    const ensHref = ensAppUrl("sepolia", QWEN_VERSION);
    const ensLink = document.querySelector(`a[href="${ensHref}"]`);
    expect(ensLink).not.toBeNull();

    expect(screen.getByText(/"lockfileVersion": 1/)).toBeInTheDocument();
  });

  it("marks Jeff's latest version and links the older version name", async () => {
    renderName(JEFF);
    expect(await screen.findByRole("heading", { name: "tiny-random" })).toBeInTheDocument();

    const versions = screen.getByRole("table", { name: "Versions" });
    const latestRow = versions.querySelector("tr[data-latest='true']");
    expect(latestRow).toBeInstanceOf(HTMLTableRowElement);
    if (!(latestRow instanceof HTMLTableRowElement)) throw new Error("expected latest row");
    expect(within(latestRow).getByText("latest")).toBeInTheDocument();
    expect(within(latestRow).getByText("0.2.0")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: JEFF_OLD })).toHaveAttribute(
      "href",
      `/name/${encodeURIComponent(JEFF_OLD)}`,
    );
  });

  it("resolves a version-name URL to the model", async () => {
    renderName(JEFF_OLD);
    expect(await screen.findByRole("heading", { name: "tiny-random" })).toBeInTheDocument();
    expect(screen.getAllByText(JEFF).length).toBeGreaterThan(0);
  });

  it("shows the unknown-name state", async () => {
    renderName("nope.eth");
    expect(await screen.findByText("Unknown name")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
  });

  it("reorders file rows when sorting by size", async () => {
    renderName(QWEN);
    await screen.findByRole("heading", { name: "Qwen2.5-7B-Instruct" });

    const before = filePaths();
    expect(before[0]).toBe(".gitattributes");

    fireEvent.click(screen.getByRole("button", { name: "size" }));
    const after = filePaths();
    expect(after).not.toEqual(before);
    expect(after[0]).toBe("generation_config.json");
  });
});
