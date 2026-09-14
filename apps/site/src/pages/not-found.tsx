import { Link } from "react-router";
import { EmptyState } from "../components/states.js";

export function NotFoundPage() {
  return (
    <EmptyState title="Page not found">
      <Link to="/">Back to models</Link>
    </EmptyState>
  );
}
