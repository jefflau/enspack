import { type ReactNode, createContext, useContext } from "react";
import { demoFixtures } from "../demo/fixtures.js";
import { FixtureIndexClient, HttpIndexClient, type IndexClient } from "./client.js";
import { type SiteConfig, config } from "./config.js";

export function createClient(cfg: SiteConfig): IndexClient {
  return cfg.dataSource === "demo"
    ? new FixtureIndexClient(demoFixtures)
    : new HttpIndexClient(cfg.indexUrl, cfg.registrarUrl);
}

const ClientContext = createContext<IndexClient | null>(null);

export function ClientProvider({
  client,
  children,
}: {
  client?: IndexClient;
  children: ReactNode;
}) {
  const value = client ?? createClient(config);
  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}

export function useClient(): IndexClient {
  const c = useContext(ClientContext);
  if (c === null) throw new Error("useClient outside ClientProvider");
  return c;
}
