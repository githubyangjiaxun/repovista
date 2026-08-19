import { JobProgress } from "@/components/job-progress";
import { SiteHeader } from "@/components/site-header";

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ jobId }, query] = await Promise.all([params, searchParams]);
  return (
    <main className="standard-page progress-page">
      <SiteHeader compact />
      <section className="progress-shell">
        <JobProgress
          jobId={jobId}
          repositoryId={typeof query.repositoryId === "string" ? query.repositoryId : undefined}
          snapshotId={typeof query.snapshotId === "string" ? query.snapshotId : undefined}
        />
      </section>
    </main>
  );
}
