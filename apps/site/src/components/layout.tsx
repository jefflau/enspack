import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { config } from "../lib/config.js";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="site">
      {config.chain !== "mainnet" && (
        <div className="banner" role="note">
          Showing {config.chain} testnet data. Mainnet follows once the v1 path is live.
        </div>
      )}
      <header className="site-header">
        <Link to="/" className="wordmark">
          enspack
        </Link>
        <nav className="site-nav" aria-label="Main">
          <NavLink to="/">Models</NavLink>
          <NavLink to="/violations">Violations</NavLink>
          <NavLink to="/get-started">Get started</NavLink>
          <a href={config.repoUrl} rel="noreferrer" target="_blank">
            GitHub
          </a>
        </nav>
      </header>
      <main className="site-main">{children}</main>
      <footer className="site-footer">
        <span>
          <code>enspack/0.1</code> · {config.chain}
        </span>
        <span>
          <a href={`${config.repoUrl}/blob/master/SPEC.md`} rel="noreferrer" target="_blank">
            SPEC
          </a>{" "}
          · <a href={config.indexUrl}>index API</a>
        </span>
      </footer>
    </div>
  );
}
