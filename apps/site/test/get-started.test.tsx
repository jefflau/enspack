import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { config } from "../src/lib/config.js";
import { GetStartedPage } from "../src/pages/get-started.js";
import { renderAt } from "./helpers.js";

describe("GetStartedPage", () => {
  it("renders the registrar CTA and the enspack get command", () => {
    renderAt("/get-started", <GetStartedPage />);

    const cta = screen.getByRole("link", { name: /Claim <you>\.enspack\.eth/ });
    expect(cta.getAttribute("href")?.startsWith(config.registrarUrl)).toBe(true);
    expect(
      screen.getByText("enspack get qwen--qwen2-5-7b-instruct.mirrors.enspack.eth"),
    ).toBeInTheDocument();
  });
});
