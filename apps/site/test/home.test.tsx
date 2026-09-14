import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FixtureIndexClient, type IndexClient } from "../src/lib/client.js";
import { HomePage } from "../src/pages/home.js";
import { renderAt } from "./helpers.js";

afterEach(() => {
  cleanup();
});

const QWEN = "qwen--qwen2-5-7b-instruct.mirrors.enspack.eth";
const LLAMA = "meta-llama--llama-3-2-1b-instruct.mirrors.enspack.eth";
const JEFF = "tiny-random.jeff.enspack.eth";

function rejectingClient(): IndexClient {
  const boom = () => Promise.reject(new Error("indexer down"));
  return {
    listNames: boom,
    getName: boom,
    listPublishers: boom,
    listViolations: boom,
    getAttestation: boom,
  };
}

describe("HomePage", () => {
  it("renders three models from fixtures", async () => {
    const { findByText, getByText, getByLabelText } = renderAt("/", <HomePage />);
    expect(await findByText(QWEN)).toBeInTheDocument();
    expect(getByText(LLAMA)).toBeInTheDocument();
    expect(getByText(JEFF)).toBeInTheDocument();
    const stats = getByLabelText("Catalog stats");
    expect(stats).toHaveTextContent("3");
    expect(stats).toHaveTextContent("indexed models");
    await waitFor(() => {
      expect(document.title).toBe("enspack");
    });
  });

  it("narrows the list to one model when searching Qwen", async () => {
    const { findByText, getByLabelText, getByRole, getByText, queryByText } = renderAt(
      "/",
      <HomePage />,
    );
    await findByText(QWEN);
    fireEvent.change(getByLabelText("Search"), { target: { value: "Qwen" } });
    await waitFor(() => {
      expect(queryByText(JEFF)).not.toBeInTheDocument();
      expect(queryByText("meta-llama/llama-3-2-1b-instruct")).not.toBeInTheDocument();
    });
    expect(queryByText(QWEN)).toBeInTheDocument();
    expect(getByText(`enspack get ${LLAMA}`)).toBeInTheDocument();
    const stats = getByLabelText("Catalog stats");
    expect(stats).toHaveTextContent("3");
    expect(stats).toHaveTextContent("indexed models");
    expect(getByRole("button", { name: "Clear search" })).toBeInTheDocument();
    fireEvent.click(getByRole("button", { name: "Clear search" }));
    await waitFor(() => {
      expect(getByText("meta-llama/llama-3-2-1b-instruct")).toBeInTheDocument();
    });
    expect(queryByText(JEFF)).toBeInTheDocument();
  });

  it("filters by publisher chip", async () => {
    const { findByRole, getByText, getByLabelText, queryByText } = renderAt("/", <HomePage />);
    const chip = await findByRole("button", { name: "mirrors.enspack.eth" });
    fireEvent.click(chip);
    await waitFor(() => {
      expect(queryByText(JEFF)).not.toBeInTheDocument();
    });
    expect(getByText(QWEN)).toBeInTheDocument();
    expect(getByText(LLAMA)).toBeInTheDocument();
    const stats = getByLabelText("Catalog stats");
    expect(stats).toHaveTextContent("3");
    expect(stats).toHaveTextContent("indexed models");
  });

  it("renders the empty state when the index has no names", async () => {
    const client = new FixtureIndexClient({
      names: { items: [], nextCursor: null },
      details: {},
      publishers: { items: [] },
      violations: { items: [] },
      attestations: {},
    });
    const { findByText } = renderAt("/", <HomePage />, { client });
    expect(await findByText("No names indexed yet on sepolia.")).toBeInTheDocument();
    expect(await findByText(/enspack publish --from-hf/)).toBeInTheDocument();
    expect(await findByText(`enspack get ${QWEN}`)).toBeInTheDocument();
  });

  it("renders the error state when the client rejects", async () => {
    const { findByRole } = renderAt("/", <HomePage />, { client: rejectingClient() });
    const alert = await findByRole("alert");
    expect(alert).toHaveTextContent("Could not load models");
  });
});
