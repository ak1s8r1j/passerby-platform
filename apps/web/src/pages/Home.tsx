import { Link } from "react-router-dom";
import { useSiteConfig } from "../hooks/useSiteConfig.js";

export function Home() {
  const { ready, config } = useSiteConfig();
  // Offer video until the server says it is off.
  const video = !ready || config.video;
  return (
    <section className="hero">
      <h1>Somebody&rsquo;s walking past. Say hi.</h1>
      <div>
        <p className="lede">
          Passerby pairs you with one stranger at a time for a text{video ? " or video" : ""} chat.
          No sign-up. Adults only.
        </p>
        <div className="row">
          <Link className="btn go" to="/text">
            Start text chat
          </Link>
          {video && (
            <Link className="btn" to="/video">
              Start video chat
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
