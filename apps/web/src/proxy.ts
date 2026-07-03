import { NextResponse, type NextRequest } from "next/server";

const pilotPin = process.env.NEXA_PILOT_PIN;
const pilotUser = process.env.NEXA_PILOT_USER ?? "nexa";

function parseBasicAuth(value: string | null) {
  if (!value?.startsWith("Basic ")) return null;

  try {
    const decoded = atob(value.slice("Basic ".length));
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  if (!pilotPin) return NextResponse.next();

  const credentials = parseBasicAuth(request.headers.get("authorization"));
  if (credentials?.username === pilotUser && credentials.password === pilotPin) {
    return NextResponse.next();
  }

  return new NextResponse("NeXa pilot login required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="NeXa pilot", charset="UTF-8"',
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
