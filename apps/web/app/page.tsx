import {
  ArrowRight,
  Download,
  GitBranch,
  Map as MapIcon,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { BundledDemoLink } from "@/components/bundled-demo-link";
import { SiteHeader } from "@/components/site-header";

const features = [
  {
    icon: MapIcon,
    title: "Interactive architecture map",
    description: "Move from packages to files and symbols without losing context.",
  },
  {
    icon: ShieldCheck,
    title: "Evidence-backed answers",
    description: "Every supported conclusion points to a fixed commit and source lines.",
  },
  {
    icon: GitBranch,
    title: "Useful without AI",
    description: "TypeScript, JavaScript, and Python maps work with no model key.",
  },
  {
    icon: RefreshCw,
    title: "Incremental by evidence",
    description: "Content hashes reveal exactly what was parsed, reused, changed, or deleted.",
  },
  {
    icon: Download,
    title: "Portable snapshot reports",
    description: "Export deterministic Markdown and SVG fixed to one complete commit SHA.",
  },
];

export default function HomePage() {
  return (
    <main>
      <SiteHeader />

      <section className="hero">
        <p className="eyebrow">Evidence-first code intelligence</p>
        <h1>
          Understand any codebase
          <span className="hero-title-muted"> as a map, not a maze.</span>
        </h1>
        <p className="hero-copy">
          Paste a public GitHub repository or sign in for private GitHub App access, then explore
          architecture, source relationships, and verifiable AI guidance.
        </p>
        <form action="/repositories/new" className="import-form">
          <label className="sr-only" htmlFor="repository-url">
            Public GitHub repository URL
          </label>
          <input
            id="repository-url"
            name="url"
            placeholder="https://github.com/owner/repository"
            required
            type="url"
          />
          <button type="submit">
            Explore repository
            <ArrowRight size={18} />
          </button>
        </form>
        <p className="privacy-note">
          Imported code is never run. Private access uses short-lived installation credentials, and
          signed default-branch pushes can create incremental snapshots automatically.
        </p>
        <div className="demo-entry">
          <BundledDemoLink />
          <small>No GitHub account, model key, or external model is required.</small>
        </div>
      </section>

      <section className="feature-grid">
        {features.map(({ icon: Icon, title, description }) => (
          <article className="feature-card" key={title}>
            <Icon aria-hidden size={24} />
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
