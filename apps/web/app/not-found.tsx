import { MapPinned } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="fatal-error">
      <MapPinned size={32} />
      <h1>This part of the map does not exist.</h1>
      <p>The link may be stale or the shared report may have been revoked.</p>
      <Link className="primary-button" href="/">
        Return home
      </Link>
    </main>
  );
}
