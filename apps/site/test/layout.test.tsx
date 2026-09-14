import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Layout } from "../src/components/layout.js";
import { ClientProvider } from "../src/lib/client-context.js";
import { fixtureClient } from "./helpers.js";

function renderLayout(ui: ReactNode = <p>page</p>) {
  return render(
    <MemoryRouter>
      <ClientProvider client={fixtureClient()}>
        <Layout>{ui}</Layout>
      </ClientProvider>
    </MemoryRouter>,
  );
}

describe("Layout", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it("renders the Sepolia banner and hides it after dismiss", () => {
    const { unmount } = renderLayout();
    expect(
      screen.getByText("Showing Sepolia testnet data. Mainnet follows once the v1 path is live."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(
      screen.queryByText("Showing Sepolia testnet data. Mainnet follows once the v1 path is live."),
    ).not.toBeInTheDocument();

    unmount();
    renderLayout();
    expect(
      screen.queryByText("Showing Sepolia testnet data. Mainnet follows once the v1 path is live."),
    ).not.toBeInTheDocument();
  });

  it("nav links have the catalog hrefs", () => {
    renderLayout();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Models" })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: "Violations" })).toHaveAttribute(
      "href",
      "/violations",
    );
    expect(within(nav).getByRole("link", { name: "Get started" })).toHaveAttribute(
      "href",
      "/get-started",
    );
    expect(within(nav).getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/jefflau/enspack",
    );
  });

  it("footer shows enspack/0.1", () => {
    renderLayout();
    expect(screen.getByText("enspack/0.1")).toBeInTheDocument();
  });
});
