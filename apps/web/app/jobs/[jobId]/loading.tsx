import { LoaderCircle } from "lucide-react";

export default function JobLoading() {
  return (
    <main className="standard-page progress-page route-loading-page">
      <div className="route-loading-card">
        <LoaderCircle className="spin" size={26} aria-hidden />
        <span>Loading immutable snapshot progress…</span>
      </div>
    </main>
  );
}
