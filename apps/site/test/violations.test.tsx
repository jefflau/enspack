import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ViolationsPage } from "../src/lib/api.js";
import { FixtureIndexClient } from "../src/lib/client.js";
import { ViolationsPage as ViolationsPageView } from "../src/pages/violations.js";
import violationsOne from "./fixtures/violations-one.json";
import { demoFixtures, renderAt } from "./helpers.js";

describe("ViolationsPage", () => {
  it("shows the empty-state sentence when there are no violations", async () => {
    renderAt("/violations", <ViolationsPageView />);
    expect(
      await screen.findByText(
        "No violations. No version name has changed its contenthash after it was first set.",
      ),
    ).toBeInTheDocument();
  });

  it("renders a violation row with a name link and a sepolia block explorer link", async () => {
    const client = new FixtureIndexClient({
      ...demoFixtures,
      violations: violationsOne as ViolationsPage,
    });
    renderAt("/violations", <ViolationsPageView />, { client });

    const nameLink = await screen.findByRole("link", {
      name: "v0-1-0.tiny-random.jeff.enspack.eth",
    });
    expect(nameLink).toHaveAttribute("href", "/name/v0-1-0.tiny-random.jeff.enspack.eth");
    expect(screen.getByRole("link", { name: "9123456" })).toHaveAttribute(
      "href",
      "https://sepolia.etherscan.io/block/9123456",
    );
  });
});
