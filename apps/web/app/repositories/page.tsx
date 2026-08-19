import { Plus } from "lucide-react";
import Link from "next/link";
import { RepositoryList } from "@/components/repository-list";
import { SiteHeader } from "@/components/site-header";

export default function RepositoriesPage() {
  return (
    <main className="standard-page">
      <SiteHeader compact />
      <section className="page-shell repositories-page">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Public workspace</p>
            <h1>Indexed repositories</h1>
            <p>Every view is tied to an immutable commit and parser version.</p>
          </div>
          <Link className="primary-button" href="/repositories/new">
            <Plus size={16} /> Analyze repository
          </Link>
        </div>
        <RepositoryList />
      </section>
    </main>
  );
}
