"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";

export default function ErrorPage({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="fatal-error">
      <TriangleAlert size={32} />
      <h1>RepoVista hit an unexpected error.</h1>
      <p>No repository code was executed. Retry the view, or return to the repository list.</p>
      <button className="primary-button" onClick={retry} type="button">
        <RotateCcw size={16} /> Try again
      </button>
    </main>
  );
}
