import JobUpdatesClient from "../../[jobId]/updates/JobUpdatesClient";

type Params = { params: Promise<{ id: string }> };

export default async function JobUpdatesPage({ params }: Params) {
  const { id } = await params;
  return <JobUpdatesClient jobId={decodeURIComponent(id)} />;
}
