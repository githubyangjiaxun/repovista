import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ShareReportView } from "@/components/share-report-view";
import { SiteHeader } from "@/components/site-header";
import { type ApiEnvelope, apiOrigin, type ShareReport } from "@/lib/api";

async function reportMetadata(slug: string): Promise<ShareReport | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore
    .getAll()
    .map((item) => `${encodeURIComponent(item.name)}=${encodeURIComponent(item.value)}`)
    .join("; ");
  try {
    const response = await fetch(`${apiOrigin}/v1/share-reports/${encodeURIComponent(slug)}`, {
      cache: "no-store",
      headers: cookie ? { Cookie: cookie } : undefined,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as ApiEnvelope<ShareReport>;
    return payload.data;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const report = await reportMetadata(slug);
  if (!report) return { title: "Report unavailable — RepoVista", robots: { index: false } };
  return {
    title: `${report.title} — RepoVista`,
    robots:
      report.visibility === "private"
        ? { index: false, follow: false, noarchive: true }
        : { index: true, follow: true },
  };
}

export default async function SharePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <main className="standard-page">
      <SiteHeader compact />
      <ShareReportView slug={slug} />
    </main>
  );
}
