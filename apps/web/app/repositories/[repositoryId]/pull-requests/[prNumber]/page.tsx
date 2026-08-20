import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PullRequestImpactWorkspace } from "@/components/pull-request-impact-workspace";

export const metadata: Metadata = {
  title: "Pull request impact · RepoVista",
  description: "Inspect deterministic pull request impact and fixed source evidence.",
};

export default async function PullRequestImpactPage({
  params,
  searchParams,
}: {
  params: Promise<{ repositoryId: string; prNumber: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ repositoryId, prNumber: rawPrNumber }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const prNumber = Number.parseInt(rawPrNumber, 10);
  if (!Number.isInteger(prNumber) || prNumber < 1 || String(prNumber) !== rawPrNumber) notFound();

  return (
    <PullRequestImpactWorkspace
      initialAnalysisId={typeof query.analysisId === "string" ? query.analysisId : undefined}
      prNumber={prNumber}
      repositoryId={repositoryId}
    />
  );
}
