import type { Sponsor } from "@passerby/shared";

/**
 * A sponsor's card in the text chat stream. It is an outlined card with a "Sponsored" label so nobody takes
 * it for something the stranger said: logo on the left, label and one-line headline in the middle, one button
 * on the right. Chat messages are never styled like this.
 */
export function SponsoredCard({ sponsor }: { sponsor: Sponsor }) {
  return (
    <aside className="sponsor" aria-label="Sponsored">
      <img className="sponsor-logo" src={sponsor.logo} alt="" width={52} height={52} />
      <div className="sponsor-text">
        <span className="sponsor-tag">Sponsored</span>
        <strong>{sponsor.headline}</strong>
      </div>
      <a
        className="sponsor-cta"
        href={sponsor.url}
        target="_blank"
        rel="sponsored noopener noreferrer"
      >
        {sponsor.cta}
      </a>
    </aside>
  );
}
