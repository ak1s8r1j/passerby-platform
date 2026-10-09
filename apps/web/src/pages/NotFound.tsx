import { Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle.js";

export function NotFound() {
  usePageTitle("Page not found");
  return (
    <section className="doc">
      <h1>Page not found</h1>
      <p>
        There&rsquo;s nothing at this address. <Link to="/">Go to the start page</Link>.
      </p>
    </section>
  );
}
