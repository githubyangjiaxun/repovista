"use client";

import {
  type ArchitectureStoryV2,
  type GraphResponse,
  isBundledDemoRepository,
} from "@repovista/contracts";
import {
  BookOpen,
  Calendar,
  FileCode2,
  GitCommitHorizontal,
  Github,
  LoaderCircle,
  LockKeyhole,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ArchitectureMap } from "@/components/architecture-map";
import { apiErrorMessage, apiFetch, type ShareReport } from "@/lib/api";

function isGraph(value: unknown): value is Omit<GraphResponse, "level" | "snapshot"> {
  return typeof value === "object" && value !== null && "nodes" in value && "edges" in value;
}

function isStoryV2(value: ShareReport["content"]): value is ArchitectureStoryV2 {
  return typeof value === "object" && value !== null && "version" in value && value.version === 2;
}

export function ShareReportView({ slug }: { slug: string }) {
  const [report, setReport] = useState<ShareReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ShareReport>(`/v1/share-reports/${encodeURIComponent(slug)}`)
      .then(setReport)
      .catch((cause) => setError(apiErrorMessage(cause, "Unable to load this report.")));
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

  const story = isStoryV2(report.content) ? report.content : null;
  const bundledDemo = isBundledDemoRepository(report.repository.canonicalUrl);

  return (
    <main className="share-report">
      <header className="share-hero">
        <p className="eyebrow">
          {report.visibility === "private" ? (
            <>
              <LockKeyhole size={14} /> Private workspace report
            </>
          ) : story ? (
            "Public architecture story"
          ) : (
            "Public architecture tour"
          )}
        </p>
        {story ? <span className="story-report-title">{report.title}</span> : null}
        <h1>{story?.headline ?? report.title}</h1>
        <p>{report.content.overview}</p>
        <div className="share-meta">
          {bundledDemo ? (
            <span title="Bundled synthetic fixture; no external GitHub repository">
              <Github size={15} /> {report.repository.owner}/{report.repository.name} · bundled
            </span>
          ) : (
            <a href={report.repository.canonicalUrl} rel="noreferrer" target="_blank">
              <Github size={15} /> {report.repository.owner}/{report.repository.name}
            </a>
          )}
          <span>
            <GitCommitHorizontal size={15} /> {report.snapshot.commitSha?.slice(0, 7)}
          </span>
          <span>
            <Calendar size={15} /> {new Date(report.createdAt).toLocaleDateString()}
          </span>
        </div>
      </header>
      {story ? (
        <section className="story-metrics-grid" aria-label="Architecture metrics">
          {[
            ["Files", story.metrics.files],
            ["Symbols", story.metrics.symbols],
            ["Relationships", story.metrics.edges],
            ["Languages", story.metrics.languages.length],
          ].map(([label, value]) => (
            <article key={String(label)}>
              <strong>{value}</strong>
              <span>{label}</span>
            </article>
          ))}
        </section>
      ) : null}
      {map ? (
        <section className="share-map">
          <div className="section-heading">
            <MapTitle />
          </div>
          <ArchitectureMap compact graph={map} />
        </section>
      ) : null}
      {story ? (
        <section className="story-modules-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Key modules</p>
              <h2>Where the architecture concentrates.</h2>
            </div>
            <SparklesIcon />
          </div>
          <div className="story-module-grid">
            {story.keyModules.map((module) => (
              <article key={module.id}>
                <div>
                  <strong>{module.label}</strong>
                  <span>{module.path ?? module.representativePath ?? "top-level package"}</span>
                </div>
                <div className="story-module-facts">
                  <span>Importance {Math.round(module.importance * 100)}%</span>
                  <span>{module.inDegree + module.outDegree} connections</span>
                </div>
                <b style={{ width: `${Math.max(8, module.score * 100)}%` }} />
                <p>{module.reason}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <section className="reading-path-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recommended route</p>
            <h2>
              {story ? "A deterministic reading path." : "Read the repository in this order."}
            </h2>
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
      {story ? (
        <>
          <section className="story-evidence-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Fixed evidence</p>
                <h2>Highlights from the snapshot.</h2>
              </div>
              <FileCode2 size={22} />
            </div>
            <div className="story-evidence-grid">
              {story.evidenceHighlights.map((item) => (
                <article key={item.id}>
                  <header>
                    <code>
                      {item.path}:{item.startLine}-{item.endLine}
                    </code>
                    <span>{item.symbol ?? "file evidence"}</span>
                  </header>
                  <pre>{item.quote}</pre>
                  <small>{item.contentHash}</small>
                </article>
              ))}
            </div>
          </section>
          <section className="story-provenance" aria-label="Story provenance">
            <strong>Provenance</strong>
            <span>Snapshot {story.provenance.snapshotId}</span>
            <span>Commit {story.provenance.commitSha.slice(0, 12)}</span>
            <span>Parser {story.provenance.parserVersion}</span>
            <span>Algorithm {story.algorithmVersion}</span>
            <span>
              Generated {new Date(story.provenance.generatedAt).toLocaleDateString()} ·{" "}
              {story.provenance.generatedAtSource.replaceAll("_", " ")}
            </span>
            <span>
              {story.provenance.retrievalProfile
                ? `Profile ${story.provenance.retrievalProfile.provider} · ${story.provenance.retrievalProfile.model} · ${story.provenance.retrievalProfile.dimensions}d`
                : "No semantic profile used"}
            </span>
          </section>
        </>
      ) : null}
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

function SparklesIcon() {
  return <Sparkles size={22} />;
}
