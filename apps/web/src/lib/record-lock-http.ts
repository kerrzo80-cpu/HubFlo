import { NextResponse } from "next/server";

import { RecordLockConflictError } from "@/lib/record-edit-locks";

export function recordLockErrorResponse(error: unknown) {
  if (error instanceof RecordLockConflictError) {
    return NextResponse.json(
      {
        error: error.message,
        code: "RECORD_LOCKED",
        holderName: error.holderName,
      },
      { status: 409 },
    );
  }
  return null;
}
