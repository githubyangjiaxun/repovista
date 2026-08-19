import { Github, LibraryBig } from "lucide-react";
import Link from "next/link";

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className={compact ? "site-header site-header-compact" : "site-header"}>
      <Link className="brand" href="/">
        <span className="brand-mark">R</span>
        <span>RepoVista</span>
      </Link>
      <nav className="nav-links" aria-label="Primary navigation">
        <Link href="/repositories">
          <LibraryBig size={16} />
          Repositories
        </Link>
        <Link href="/docs">Docs</Link>
        <a href="https://github.com" rel="noreferrer" target="_blank">
          <Github size={16} />
          GitHub
        </a>
      </nav>
    </header>
  );
}
