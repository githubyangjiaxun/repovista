import { AlertTriangle, ArrowLeft, LogIn } from "lucide-react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { apiOrigin } from "@/lib/api";

const messages: Record<string, string> = {
  AUTH_SIGNUP_DISABLED: "This RepoVista deployment is not accepting new accounts.",
  GITHUB_API_FAILED: "GitHub could not complete the login request. Please try again.",
  GITHUB_AUTH_DISABLED: "GitHub login is not configured for this deployment.",
  GITHUB_IDENTITY_CONFLICT: "This GitHub identity is already linked to another account.",
  GITHUB_RATE_LIMITED: "GitHub is rate limiting login requests. Please wait and try again.",
  OAUTH_ACCESS_DENIED: "GitHub login was cancelled or denied.",
  OAUTH_CALLBACK_INVALID: "The GitHub login callback was incomplete.",
  OAUTH_STATE_INVALID: "The login request expired or could not be verified.",
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const code = typeof query.code === "string" ? query.code : "OAUTH_FAILED";
  const message = messages[code] ?? "RepoVista could not complete GitHub login.";
  return (
    <main className="standard-page">
      <SiteHeader compact />
      <section className="auth-error-card">
        <span className="auth-error-icon">
          <AlertTriangle size={24} />
        </span>
        <p className="eyebrow">Secure login</p>
        <h1>GitHub login did not finish.</h1>
        <p>{message}</p>
        <small>Error code: {code}</small>
        <div className="auth-error-actions">
          <a
            className="primary-button"
            href={`${apiOrigin}/v1/auth/github/start?returnTo=%2Frepositories`}
          >
            <LogIn size={16} /> Try again
          </a>
          <Link className="secondary-button" href="/repositories">
            <ArrowLeft size={16} /> Continue in public mode
          </Link>
        </div>
      </section>
    </main>
  );
}
