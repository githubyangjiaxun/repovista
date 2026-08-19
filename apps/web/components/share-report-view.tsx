"use client";

import type { GraphResponse } from "@repovista/contracts";
import {
  BookOpen,
  Calendar,
  FileCode2,
  GitCommitHorizontal,
  Github,
  LoaderCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ArchitectureMap } from "@/components/architecture-map";
import { ApiError, apiFetch, type ShareReport } from "@/lib/api";

function isGraph(value: unknown): value is Omit<GraphResponse, "level" | "snapshot"> {
  return typeof value === "object" && value !== null && "nodes" in value && "edges" in value;
}

export function ShareReportView({ slug }: { slug: string }) {
  const [report, setReport] = useState<ShareReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ShareReport>(`/v1/share-reports/${encodeURIComponent(slug)}`)
      .then(setReport)
      .catch((cause) =>
        setError(cause instanceof ApiError ? cause.message : "Unable to load this report."),
      );
  }, [slug]);

  if (error)
    return (
      <div className="share-state">
        <h1>Report unavailable</h1>
        <p>{error}</p>
      </div>
    );
  if (!report)
    return (
      <div className="share-state">
        <LoaderCircle className="spin" size={24} /> Loading architecture tour…
      </div>
    );

  const map = isGraph(report.content.map)
    ? ({
        ...report.content.map,
        level: "package",
        snapshot: {
          id: report.snapshot.id,
          commitSha: report.snapshot.commitSha ?? "",
          parserVersion: report.snapshot.parserVersion,
        },
      } as GraphResponse)
    : null;

  return (
    <main className="share-report">
      <header className="share-hero">
        <p className="eyebrow">Public architecture tour</p>
        <h1>{report.title}</h1>
        <p>{report.content.overview}</p>
        <div className="share-meta">
          <a href={report.repository.canonicalUrl} rel="noreferrer" target="_blank">
            <Github size={15} /> {report.repository.owner}/{report.repository.name}
          </a>
          <span>
            <GitCommitHorizontal size={15} /> {report.snapshot.commitSha?.slice(0, 7)}
          </span>
          <span>
            <Calendar size={15} /> {new Date(report.createdAt).toLocaleDateString()}
          </span>
        </div>
      </header>
      {map ? (
        <section className="share-map">
          <div className="section-heading">
            <MapTitle />
          </div>
          <ArchitectureMap compact graph={map} />
        </section>
      ) : null}
      <section className="reading-path-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recommended route</p>
            <h2>Read the repository in this order.</h2>
          </div>
          <BookOpen size={22} />
        </div>
        <ol>
          {report.content.readingPath.map((item) => (
            <li key={item.path}>
              <span>
                <FileCode2 size={16} />
              </span>
              <div>
                <strong>{item.path}</strong>
                <p>{item.reason}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <footer className="share-footer">
        <span>
          Generated from a fixed RepoVista snapshot. Source facts remain useful without AI.
        </span>
        <a className="primary-button" href="/repositories/new">
          Map your repository
        </a>
      </footer>
    </main>
  );
}

function MapTitle() {
  return (
    <div>
      <p className="eyebrow">System topology</p>
      <h2>Package architecture at a glance.</h2>
    </div>
  );
}
