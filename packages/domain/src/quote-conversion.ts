export type QuoteConversionStatus =
  | "Draft"
  | "Sent"
  | "Accepted"
  | "Declined"
  | "Converted"
  | "Lost";

export type QuoteConversionInput = {
  status: QuoteConversionStatus;
  convertedJobId?: string | null;
};

export type QuoteConversionDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "QUOTE_NOT_ACCEPTED" | "QUOTE_ALREADY_CONVERTED";
      detail: string;
    };

export function checkQuoteConversion(
  input: QuoteConversionInput,
): QuoteConversionDecision {
  if (input.status === "Converted" || input.convertedJobId) {
    return {
      allowed: false,
      code: "QUOTE_ALREADY_CONVERTED",
      detail: "Converted quotes cannot create another job.",
    };
  }

  if (input.status !== "Accepted") {
    return {
      allowed: false,
      code: "QUOTE_NOT_ACCEPTED",
      detail: "Only accepted quotes can be converted into jobs.",
    };
  }

  return { allowed: true };
}
