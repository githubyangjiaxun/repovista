import { Github, LockKeyhole, Network, ShieldCheck } from "lucide-react";
import { ImportRepositoryForm } from "@/components/import-repository-form";
import { SiteHeader } from "@/components/site-header";

export default async function NewRepositoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const initialUrl = typeof query.url === "string" ? query.url : "";
  return (
    <main className="standard-page">
      <SiteHeader compact />
      <section className="new-repository-layout">
        <div className="new-repository-copy">
          <p className="eyebrow">Start with facts</p>
          <h1>Turn a public repository into an explorable system.</h1>
          <p>
            RepoVista pins one Git commit, parses its source, builds deterministic relationships,
            and creates evidence that optional AI can explain.
          </p>
          <div className="security-points">
            <div>
              <ShieldCheck size={19} />
              <span>
                <strong>Source is never executed</strong>
                <small>No install scripts, builds, or repository commands.</small>
              </span>
            </div>
            <div>
              <Network size={19} />
              <span>
                <strong>Static analysis first</strong>
                <small>Maps, search, and source navigation need no model.</small>
              </span>
            </div>
            <div>
              <LockKeyhole size={19} />
              <span>
                <strong>Public GitHub repositories only</strong>
                <small>HTTPS URLs without embedded credentials.</small>
              </span>
            </div>
          </div>
        </div>
        <div className="new-repository-card">
          <div className="card-title">
            <span>
              <Github size={20} />
            </span>
            <div>
              <h2>Analyze a repository</h2>
              <p>Usually ready in under a minute for small projects.</p>
            </div>
          </div>
          <ImportRepositoryForm initialUrl={initialUrl} />
        </div>
      </section>
    </main>
  );
}
