import { Route, Routes } from "react-router";
import { Layout } from "./components/layout.js";
import { GetStartedPage } from "./pages/get-started.js";
import { HomePage } from "./pages/home.js";
import { ModelPage } from "./pages/model.js";
import { NotFoundPage } from "./pages/not-found.js";
import { PublisherPage } from "./pages/publisher.js";
import { ViolationsPage } from "./pages/violations.js";

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/name/:name" element={<ModelPage />} />
        <Route path="/publisher/:label" element={<PublisherPage />} />
        <Route path="/violations" element={<ViolationsPage />} />
        <Route path="/get-started" element={<GetStartedPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}
