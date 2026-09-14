import { type RenderResult, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { demoFixtures } from "../src/demo/fixtures.js";
import { ClientProvider } from "../src/lib/client-context.js";
import { FixtureIndexClient, type IndexClient } from "../src/lib/client.js";

export { demoFixtures };

export function fixtureClient(): IndexClient {
  return new FixtureIndexClient(demoFixtures);
}

/** Renders `ui` under a router at `path`, with the fixture client (or a custom one). */
export function renderAt(
  path: string,
  ui: ReactNode,
  opts: { client?: IndexClient; routePattern?: string } = {},
): RenderResult {
  const client = opts.client ?? fixtureClient();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ClientProvider client={client}>
        <Routes>
          <Route path={opts.routePattern ?? path} element={ui} />
        </Routes>
      </ClientProvider>
    </MemoryRouter>,
  );
}
