import { SettingsWorkspace } from "@/components/settings-workspace";
import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <main className="standard-page">
      <SiteHeader compact />
      <section className="page-shell settings-page">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Private collaboration</p>
            <h1>Workspace settings</h1>
            <p>Manage members, GitHub App access, API tokens, and security activity.</p>
          </div>
        </div>
        <SettingsWorkspace />
      </section>
    </main>
  );
}
