import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getClients } from "@/lib/lead-store";

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showCustomers) {
    return NextResponse.json([]);
  }

  const search = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
  const clients = getClients();

  if (!search) {
    return NextResponse.json(clients);
  }

  const filtered = clients.filter((client) =>
    [client.name, client.primaryContact, client.email, client.phone, client.billingAddress]
      .some((value) => value.toLowerCase().includes(search)),
  );

  return NextResponse.json(filtered);
}

