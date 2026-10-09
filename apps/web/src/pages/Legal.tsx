import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle.js";
import { useSiteConfig } from "../hooks/useSiteConfig.js";

/** How to reach the people who run the site, as a mailto link when an address is configured. */
function useContact(): ReactNode {
  const { config } = useSiteConfig();
  return config.contact ? (
    <a href={`mailto:${config.contact}`}>{config.contact}</a>
  ) : (
    "the site operator"
  );
}

function Doc({ title, children }: { title: string; children: ReactNode }) {
  usePageTitle(title);
  return (
    <section className="doc">
      <h1>{title}</h1>
      {children}
    </section>
  );
}

export function Rules() {
  const { config } = useSiteConfig();
  const contact = useContact();
  return (
    <Doc title="Rules">
      <p>
        {config.name} only works if people treat each other decently. Breaking these rules gets you
        removed.
      </p>
      <ol>
        <li>You must be 18 or older. Anyone who says or shows they are younger is removed.</li>
        <li>No nudity or sexual content, in video or in text.</li>
        <li>No harassment, hate, threats or bullying.</li>
        <li>If someone seems to be under 18, end the chat and report it.</li>
        <li>
          Don&rsquo;t share personal details such as a full name, address, phone number, social
          accounts or payment details.
        </li>
        <li>No spam, selling, or sending people to other sites.</li>
        <li>Don&rsquo;t record or screenshot anyone without their consent.</li>
        <li>Nothing illegal.</li>
      </ol>
      <h2>How the rules are enforced</h2>
      <p>
        Saying you are under 18 in a chat removes you for 24 hours straight away, and the last
        messages are saved for a moderator to review. Moderators can ban for longer.
      </p>
      <p>Questions about a ban: contact {contact}.</p>
    </Doc>
  );
}

export function Terms() {
  const { config } = useSiteConfig();
  const contact = useContact();
  return (
    <Doc title="Terms">
      <p>By using {config.name} you agree to these terms.</p>
      <h2>Who can use it</h2>
      <p>
        You must be at least 18 years old and allowed to use a service like this where you live.
      </p>
      <h2>Your conduct</h2>
      <p>
        You agree to follow the <Link to="/rules">rules</Link>. You are responsible for what you
        say, show and share. We can end chats and block access at any time to keep the service safe.
      </p>
      <h2>Accounts</h2>
      <p>
        An account is optional. Keep your password private; you are responsible for what happens
        under your account, including one you reach through Google. We can suspend or delete
        accounts that break the rules. You can delete your own account at any time from the{" "}
        <Link to="/account">account page</Link>.
      </p>
      <h2>Other people</h2>
      <p>
        You talk to strangers at your own risk. We don&rsquo;t check who people are and can&rsquo;t
        promise how they will behave.
      </p>
      <h2>No warranty</h2>
      <p>
        The service is provided as it is, without guarantees that it will always be available or
        free of errors. To the extent the law allows, we are not liable for losses that come from
        using it.
      </p>
      <h2>Changes</h2>
      <p>
        We may update these terms. If you keep using {config.name} after a change, the new terms
        apply. Questions: {contact}.
      </p>
      <p>Last updated October 2026.</p>
    </Doc>
  );
}

export function Privacy() {
  const { config } = useSiteConfig();
  const contact = useContact();
  return (
    <Doc title="Privacy">
      <p>{config.name} is built to hold as little about you as it can.</p>
      <h2>What we handle</h2>
      <ul>
        <li>
          <strong>Your IP address.</strong> We turn it into a scrambled ID that we can&rsquo;t
          reverse, and use it to limit abuse and make bans work. The address itself is not stored.
        </li>
        <li>
          <strong>Text messages.</strong> They pass through our server to reach the other person.
          The last 40 messages of a chat are kept in memory while it is open and then discarded,
          unless the chat is reported or someone says they are under 18, in which case they are
          saved so a moderator can review them.
        </li>
        <li>
          <strong>Video and audio.</strong> They go directly between your browser and the other
          person&rsquo;s. We don&rsquo;t record or store them. A direct connection can reveal your
          IP address to the other person.
        </li>
        <li>
          <strong>Your choices.</strong> Your interests, language and gender choice, and whether you
          have confirmed you are 18 or older, are stored in your own browser. Your interests,
          language and gender choice are sent to our server only to find you a match.
        </li>
        <li>
          <strong>Accounts (optional).</strong> If you make an account we store your email address,
          display name, a hashed password (never the password itself), and when you registered and
          last signed in. If you use Continue with Google instead, we store the email address and
          name Google gives us, and Google&rsquo;s private ID for you, so we can recognise you next
          time; we never see your Google password. Your account is never shown to the people you
          chat with.
        </li>
        <li>
          <strong>Activity log.</strong> We keep a log of events such as sign-ups, sign-ins, failed
          sign-ins, password changes and account deletions, labelled with a short form of your
          scrambled ID. It never contains your email address, your password or what you said, and it
          is used to run and protect the service.
        </li>
        <li>
          <strong>Cookies.</strong> The only cookie we keep is a sign-in cookie, and only if you
          sign in. Going to Google and back uses a one-time security cookie that is removed when you
          return (and expires after ten minutes at most). We don&rsquo;t use advertising or tracking
          cookies.
        </li>
      </ul>
      <h2>Other services</h2>
      <p>
        The site loads its typeface from Google Fonts, so Google receives your IP address when a
        page loads. Video chat uses a Google server (STUN) to help browsers find each other. If you
        choose Continue with Google, Google learns that you are signing in to {config.name}
        and is subject to its own privacy policy.
      </p>
      <h2>Your choices</h2>
      <p>
        You can download everything stored about your account, or delete the account, from the{" "}
        <Link to="/account">account page</Link>. For anything else, including a report about you,
        contact {contact}.
      </p>
      <p>Last updated October 2026.</p>
    </Doc>
  );
}
