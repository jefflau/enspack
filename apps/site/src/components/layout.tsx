import { type ReactNode, useState } from "react";
import { Link, NavLink } from "react-router";
import { config } from "../lib/config.js";
import { ExternalLink } from "./external-link.js";

/** Session-only so a new tab still sees the banner; reload in this tab stays dismissed. */
const BANNER_STORAGE_KEY = "enspack.banner.dismissed";

function bannerDismissed(): boolean {
  try {
    return sessionStorage.getItem(BANNER_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistBannerDismissed(): void {
  try {
    sessionStorage.setItem(BANNER_STORAGE_KEY, "1");
  } catch {
    // private mode can throw; still hide for this document
  }
}

function WordmarkMark() {
  return (
    <svg className="wordmark-mark" width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 1.15 14.4 4.7v6.6L8 14.85 1.6 11.3V4.7L8 1.15Zm0 1.7L3.25 5.5v5l4.75 2.6 4.75-2.6v-5L8 2.85Z"
      />
    </svg>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [showBanner, setShowBanner] = useState(
    () => config.chain !== "mainnet" && !bannerDismissed(),
  );

  function dismissBanner(): void {
    persistBannerDismissed();
    setShowBanner(false);
  }

  return (
    <div className="site">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      {showBanner && (
        <aside className="banner">
          <p className="banner-text">
            Showing Sepolia testnet data. Mainnet follows once the v1 path is live.
          </p>
          <button type="button" className="banner-dismiss" onClick={dismissBanner}>
            Dismiss
          </button>
        </aside>
      )}
      <header className="site-header">
        <Link to="/" className="wordmark">
          <WordmarkMark />
          enspack
        </Link>
        <nav className="site-nav" aria-label="Main">
          <NavLink to="/" end>
            Models
          </NavLink>
          <NavLink to="/violations">Violations</NavLink>
          <NavLink to="/get-started">Get started</NavLink>
          <ExternalLink href={config.repoUrl}>GitHub</ExternalLink>
        </nav>
      </header>
      <main id="content" className="site-main">
        {children}
      </main>
      <footer className="site-footer">
        <span>
          <code>enspack/0.1</code> · {config.chain}
        </span>
        <span className="site-footer-links">
          <ExternalLink href={`${config.repoUrl}/blob/master/SPEC.md`}>SPEC.md</ExternalLink>
          {" · "}
          <ExternalLink href={config.indexUrl}>{config.indexUrl}</ExternalLink>
          {" · "}
          <ExternalLink href={config.registrarUrl}>registrar</ExternalLink>
        </span>
      </footer>
    </div>
  );
}
