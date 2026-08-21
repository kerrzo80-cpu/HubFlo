import JobUpdatesClient from "./JobUpdatesClient";

type Params = { params: Promise<{ jobId: string }> };

export default async function JobUpdatesPage({ params }: Params) {
  const { jobId } = await params;
  return <JobUpdatesClient jobId={decodeURIComponent(jobId)} />;
}
