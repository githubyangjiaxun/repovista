import { ArrowRight, GitBranch, Map as MapIcon, ShieldCheck } from "lucide-react";
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
    description: "Static analysis, source navigation, and search work with no model key.",
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
          Paste a public GitHub repository and explore its architecture, source relationships, and
          verifiable AI guidance.
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
          Public repositories only in v0.1. Imported code is never run.
        </p>
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
