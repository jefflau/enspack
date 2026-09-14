import { Link } from "react-router";
import { EmptyState } from "../components/states.js";
import { useDocumentTitle } from "../lib/use-document-title.js";

export function NotFoundPage() {
  useDocumentTitle("Not found");
  return (
    <EmptyState title="Page not found">
      <Link to="/">Back to models</Link>
    </EmptyState>
  );
}
