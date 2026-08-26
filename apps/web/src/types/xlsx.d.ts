declare module "xlsx" {
  export function read(
    data: Buffer | ArrayBuffer | Uint8Array,
    opts?: { type?: string; cellDates?: boolean },
  ): {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };

  export function write(
    workbook: { SheetNames: string[]; Sheets: Record<string, unknown> },
    opts?: { type?: string; bookType?: string },
  ): Buffer;

  export const utils: {
    book_new: () => { SheetNames: string[]; Sheets: Record<string, unknown> };
    book_append_sheet: (
      workbook: { SheetNames: string[]; Sheets: Record<string, unknown> },
      sheet: unknown,
      name?: string,
    ) => void;
    aoa_to_sheet: (data: unknown[][]) => unknown;
    sheet_to_json: <T = unknown>(
      sheet: unknown,
      opts?: {
        header?: number | string[];
        defval?: unknown;
        blankrows?: boolean;
        raw?: boolean;
      },
    ) => T[];
  };
}
