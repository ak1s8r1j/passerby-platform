import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <section className="doc">
      <h1>Page not found</h1>
      <p>
        There&rsquo;s nothing at this address. <Link to="/">Go to the start page</Link>.
      </p>
    </section>
  );
}
