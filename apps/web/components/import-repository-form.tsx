"use client";

import { ArrowRight, ChevronDown, Github, LoaderCircle, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { ApiError, apiFetch, type CreateRepositoryResult } from "@/lib/api";

function validateGitHubUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      !["github.com", "www.github.com"].includes(parsed.hostname)
    ) {
      return "Use a public HTTPS github.com repository URL.";
    }
    if (parsed.pathname.split("/").filter(Boolean).length !== 2) {
      return "The URL should look like https://github.com/owner/repository.";
    }
    return null;
  } catch {
    return "Enter a valid GitHub repository URL.";
  }
}

export function ImportRepositoryForm({ initialUrl = "" }: { initialUrl?: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [ref, setRef] = useState("");
  const [ignore, setIgnore] = useState("dist\nbuild\ndocs/generated");
  const [advanced, setAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateGitHubUrl(url.trim());
    if (validation) {
      setError(validation);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiFetch<CreateRepositoryResult>("/v1/repositories", {
        method: "POST",
        body: JSON.stringify({
          url: url.trim(),
          ...(ref.trim() ? { ref: ref.trim() } : {}),
          ignore: ignore
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean),
        }),
      });
      const query = new URLSearchParams({
        repositoryId: result.repositoryId,
        snapshotId: result.snapshotId,
      });
      router.push(`/jobs/${result.jobId}?${query.toString()}`);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? `${cause.message}${cause.requestId ? ` Request ID: ${cause.requestId}` : ""}`
          : "Unable to start the repository analysis.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="new-repository-form" onSubmit={submit}>
      <div className="form-section">
        <label htmlFor="repository-url">Public GitHub repository</label>
        <div className="input-with-icon">
          <Github aria-hidden size={19} />
          <input
            autoComplete="url"
            id="repository-url"
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://github.com/owner/repository"
            required
            type="url"
            value={url}
          />
        </div>
        <p className="field-hint">
          RepoVista clones source code only. It never installs packages or runs repository scripts.
        </p>
      </div>

      <button
        aria-expanded={advanced}
        className="advanced-toggle"
        onClick={() => setAdvanced((value) => !value)}
        type="button"
      >
        Analysis options
        <ChevronDown className={advanced ? "rotate" : ""} size={17} />
      </button>

      {advanced ? (
        <div className="advanced-fields">
          <div className="form-section">
            <label htmlFor="repository-ref">Branch, tag, or commit</label>
            <input
              id="repository-ref"
              onChange={(event) => setRef(event.target.value)}
              placeholder="Default branch"
              value={ref}
            />
          </div>
          <div className="form-section">
            <label htmlFor="repository-ignore">Ignored paths</label>
            <textarea
              id="repository-ignore"
              onChange={(event) => setIgnore(event.target.value)}
              rows={4}
              value={ignore}
            />
            <p className="field-hint">One repository-relative directory or file per line.</p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}

      <button className="primary-button wide-button" disabled={submitting} type="submit">
        {submitting ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}
        {submitting ? "Starting analysis…" : "Analyze repository"}
        {!submitting ? <ArrowRight size={18} /> : null}
      </button>
    </form>
  );
}
