export type JobInvoiceReviewState = {
  construction: boolean;
  commercial: boolean;
  office: boolean;
};

export function jobInvoiceReviewComplete(value: unknown): value is JobInvoiceReviewState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const review = value as Partial<JobInvoiceReviewState>;
  return review.construction === true && review.commercial === true && review.office === true;
}
