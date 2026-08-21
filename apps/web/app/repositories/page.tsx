import { RepositoryImportLink } from "@/components/repository-import-link";
import { RepositoryList } from "@/components/repository-list";
import { SiteHeader } from "@/components/site-header";

export default function RepositoriesPage() {
  return (
    <main className="standard-page">
      <SiteHeader compact />
      <section className="page-shell repositories-page">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Active workspace</p>
            <h1>Indexed repositories</h1>
            <p>Public and private views stay tied to an immutable commit and parser version.</p>
          </div>
          <RepositoryImportLink />
        </div>
        <RepositoryList />
      </section>
    </main>
  );
}
