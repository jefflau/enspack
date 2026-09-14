import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PublisherPage } from "../src/pages/publisher.js";
import { renderAt } from "./helpers.js";

const route = { routePattern: "/publisher/:label" };

afterEach(() => {
  cleanup();
});

describe("PublisherPage", () => {
  it("shows the no-attestation sentence and two models for mirrors", async () => {
    renderAt("/publisher/mirrors.enspack.eth", <PublisherPage />, route);

    expect(
      await screen.findByText(/No registrar attestation\. This name is not issued through/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "qwen--qwen2-5-7b-instruct.mirrors.enspack.eth" }),
    ).toHaveAttribute("href", "/name/qwen--qwen2-5-7b-instruct.mirrors.enspack.eth");
    expect(
      screen.getByRole("link", {
        name: "meta-llama--llama-3-2-1b-instruct.mirrors.enspack.eth",
      }),
    ).toHaveAttribute("href", "/name/meta-llama--llama-3-2-1b-instruct.mirrors.enspack.eth");
  });

  it("shows the HF namespace, verified badge, and attestation table for jeff", async () => {
    renderAt("/publisher/jeff.enspack.eth", <PublisherPage />, route);

    const hf = await screen.findByRole("link", { name: "jefflau" });
    expect(hf).toHaveAttribute("href", "https://huggingface.co/jefflau");
    expect(screen.getByText("HF verified")).toBeInTheDocument();
    expect(screen.getByText("jefflau/enspack-verify")).toBeInTheDocument();

    const txLinks = screen
      .getAllByRole("link")
      .filter((el) => el.getAttribute("href")?.includes("etherscan.io/tx/"));
    expect(txLinks.length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "0xd368b0e8bbbd4a474a846a5fbfab4d8cfc1b3f8f413d25dbce5605f3fd38bbc260af54755aae952ac69e62de639b238540c593d6d3e6e9cc992768ff150fdc987f",
      ),
    ).toBeInTheDocument();
    expect(document.title).toBe("jeff.enspack.eth · enspack");
  });

  it("shows the unknown-publisher empty state", async () => {
    renderAt("/publisher/nope.eth", <PublisherPage />, route);
    expect(await screen.findByText("Unknown publisher")).toBeInTheDocument();
  });
});
