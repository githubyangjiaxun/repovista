import { RepositoryExplorer } from "@/components/repository-explorer";

export default async function RepositoryPage({
  params,
}: {
  params: Promise<{ repositoryId: string }>;
}) {
  const { repositoryId } = await params;
  return <RepositoryExplorer repositoryId={repositoryId} />;
}
