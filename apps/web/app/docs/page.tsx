import {
  Bot,
  Database,
  Download,
  GitBranch,
  Network,
  RefreshCw,
  ShieldCheck,
  Webhook,
} from "lucide-react";
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
    copy: "Tree-sitter extracts files, symbols, imports, calls, inheritance, and containment for TypeScript, JavaScript, and Python.",
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

const capabilities = [
  {
    icon: RefreshCw,
    title: "Full → incremental snapshots",
    copy: "The first compatible run is full. Later runs compare path and content hash, reparse changed supported files, reuse unchanged parsed files, and rebuild the complete immutable graph.",
  },
  {
    icon: Webhook,
    title: "Signed GitHub updates",
    copy: "An optional HMAC-SHA256 webhook accepts public-repository pushes. Only non-deleted pushes to the default branch create jobs, and delivery IDs are idempotent.",
  },
  {
    icon: Download,
    title: "Deterministic exports",
    copy: "Every ready snapshot can produce Markdown and SVG containing its snapshot ID, complete commit SHA, parser version, and static-analysis provenance.",
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
        <div className="docs-capabilities">
          {capabilities.map(({ icon: Icon, title, copy }) => (
            <section key={title}>
              <Icon size={20} aria-hidden />
              <h2>{title}</h2>
              <p>{copy}</p>
            </section>
          ))}
        </div>
        <aside className="docs-boundary">
          <strong>Current automation boundary</strong>
          <p>
            Public repositories only. RepoVista does not use installation tokens, clone private
            repositories, execute imported code, or treat AI-generated text as static-analysis fact.
          </p>
        </aside>
      </article>
    </main>
  );
}
