declare module "xlsx" {
  export function read(
    data: Buffer | ArrayBuffer | Uint8Array,
    opts?: { type?: string; cellDates?: boolean },
  ): {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };

  export const utils: {
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
