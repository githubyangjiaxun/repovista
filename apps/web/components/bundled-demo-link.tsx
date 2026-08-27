"use client";

import { BUNDLED_DEMO_REPOSITORY } from "@repovista/contracts";
import { ArrowRight, FlaskConical, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch, type RepositorySummary } from "@/lib/api";

type DemoState =
  | { status: "loading" }
  | { status: "ready"; repositoryId: string; snapshotId: string }
  | { status: "fallback" };

export function BundledDemoLink({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<DemoState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    apiFetch<RepositorySummary[]>("/v1/repositories")
      .then((repositories) => {
        if (!active) return;
        const demo = repositories.find(
          (repository) => repository.canonicalUrl === BUNDLED_DEMO_REPOSITORY.canonicalUrl,
        );
        if (demo?.latestSnapshotId && demo.latestSnapshotStatus === "ready") {
          setState({
            status: "ready",
            repositoryId: demo.id,
            snapshotId: demo.latestSnapshotId,
          });
        } else {
          setState({ status: "fallback" });
        }
      })
      .catch(() => {
        if (active) setState({ status: "fallback" });
      });
    return () => {
      active = false;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <span className={compact ? "bundled-demo-link compact" : "bundled-demo-link loading"}>
        <LoaderCircle className="spin" size={16} /> Checking bundled demo…
      </span>
    );
  }

  if (state.status === "ready") {
    return (
      <Link
        className={compact ? "bundled-demo-link compact" : "bundled-demo-link"}
        href={`/repositories/${encodeURIComponent(state.repositoryId)}?snapshotId=${encodeURIComponent(state.snapshotId)}`}
      >
        <FlaskConical size={17} />
        {compact ? "Bundled demo" : "Open the bundled demo"}
        <ArrowRight size={16} />
      </Link>
    );
  }

  return (
    <Link
      className={compact ? "bundled-demo-link compact" : "bundled-demo-link"}
      href="/repositories"
    >
      <FlaskConical size={17} /> Browse demo repositories <ArrowRight size={16} />
    </Link>
  );
}
