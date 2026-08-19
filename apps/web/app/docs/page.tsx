import { Bot, Database, GitBranch, Network, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/site-header";

const layers = [
  {
    icon: GitBranch,
    title: "1. Immutable Git snapshot",
    copy: "A public HTTPS repository is cloned at one branch, tag, or commit. Repository scripts are never executed.",
  },
  {
    icon: Network,
    title: "2. Deterministic code graph",
    copy: "Tree-sitter extracts files, symbols, imports, calls, and containment relationships for TypeScript and JavaScript.",
  },
  {
    icon: Database,
    title: "3. Searchable evidence",
    copy: "Source chunks, paths, symbols, commit SHA, hashes, and line ranges are persisted in PostgreSQL.",
  },
  {
    icon: Bot,
    title: "4. Optional explanation",
    copy: "Fake, local Ollama, or OpenAI-compatible providers may explain retrieved evidence. Invalid citations are removed.",
  },
];

export default function DocsPage() {
  return (
    <main className="standard-page">
      <SiteHeader compact />
      <article className="docs-page">
        <p className="eyebrow">How RepoVista works</p>
        <h1>AI can explain the map. It does not invent the map.</h1>
        <p className="docs-intro">
          RepoVista is built around a strict separation between deterministic code facts and
          model-generated language. This makes the product useful with no AI configuration and
          auditable when AI is enabled.
        </p>
        <div className="docs-layers">
          {layers.map(({ icon: Icon, title, copy }) => (
            <section key={title}>
              <Icon size={21} />
              <div>
                <h2>{title}</h2>
                <p>{copy}</p>
              </div>
            </section>
          ))}
        </div>
        <aside className="docs-principle">
          <ShieldCheck size={22} />
          <div>
            <strong>Evidence contract</strong>
            <p>
              Every displayed citation must belong to the active snapshot and carry a real path,
              line range, immutable commit, and stored content hash.
            </p>
          </div>
        </aside>
      </article>
    </main>
  );
}
