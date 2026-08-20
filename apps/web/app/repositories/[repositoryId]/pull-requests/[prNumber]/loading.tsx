import { LoaderCircle } from "lucide-react";

export default function PullRequestImpactLoading() {
  return (
    <main className="impact-state-page">
      <LoaderCircle className="spin" size={30} />
      <h1>Opening impact workspace…</h1>
      <p>Loading the selected repository and immutable analysis revision.</p>
    </main>
  );
}
