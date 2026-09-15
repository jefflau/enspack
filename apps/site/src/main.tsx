import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app.js";
import { ClientProvider } from "./lib/client-context.js";
import { routerBasename } from "./lib/config.js";
import "./styles/tokens.css";
import "./styles/global.css";

const root = document.getElementById("root");
if (root === null) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter basename={routerBasename(import.meta.env.BASE_URL)}>
      <ClientProvider>
        <App />
      </ClientProvider>
    </BrowserRouter>
  </StrictMode>,
);
