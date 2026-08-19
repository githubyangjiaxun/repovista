import { ShareReportView } from "@/components/share-report-view";
import { SiteHeader } from "@/components/site-header";

export default async function SharePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <main className="standard-page">
      <SiteHeader compact />
      <ShareReportView slug={slug} />
    </main>
  );
}
