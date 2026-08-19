import { RepositoryExplorer } from "@/components/repository-explorer";

export default async function RepositoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ repositoryId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ repositoryId }, query] = await Promise.all([params, searchParams]);
  return (
    <RepositoryExplorer
      repositoryId={repositoryId}
      snapshotId={typeof query.snapshotId === "string" ? query.snapshotId : undefined}
    />
  );
}
