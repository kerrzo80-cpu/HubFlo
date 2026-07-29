import { NextResponse } from "next/server";

type PostcodeEntry = {
  postcode: string;
  addresses: string[];
};

/** Seeded Aberdeen-area addresses for offline / demo lookup. */
const LOCAL_POSTCODE_DIRECTORY: PostcodeEntry[] = [
  {
    postcode: "AB10 1AA",
    addresses: [
      "1 Test Street, Aberdeen, AB10 1AA",
      "3 Test Street, Aberdeen, AB10 1AA",
      "5 Test Street, Aberdeen, AB10 1AA",
    ],
  },
  {
    postcode: "AB10 1YP",
    addresses: [
      "10 Albyn Terrace, Aberdeen, AB10 1YP",
      "12 Albyn Terrace, Aberdeen, AB10 1YP",
      "14 Albyn Terrace, Aberdeen, AB10 1YP",
      "16 Albyn Terrace, Aberdeen, AB10 1YP",
    ],
  },
  {
    postcode: "AB10 6PL",
    addresses: [
      "8 Hopetoun Court, Aberdeen, AB10 6PL",
      "10 Hopetoun Court, Aberdeen, AB10 6PL",
      "12 Hopetoun Court, Aberdeen, AB10 6PL",
    ],
  },
  {
    postcode: "AB15 4EQ",
    addresses: [
      "136 King's Gate, Aberdeen, AB15 4EQ",
      "138 King's Gate, Aberdeen, AB15 4EQ",
      "140 King's Gate, Aberdeen, AB15 4EQ",
      "142 King's Gate, Aberdeen, AB15 4EQ",
    ],
  },
  {
    postcode: "AB15 4YE",
    addresses: [
      "40 Queen's Road, Aberdeen, AB15 4YE",
      "42 Queen's Road, Aberdeen, AB15 4YE",
      "44 Queen's Road, Aberdeen, AB15 4YE",
      "46 Queen's Road, Aberdeen, AB15 4YE",
      "48 Queen's Road, Aberdeen, AB15 4YE",
    ],
  },
  {
    postcode: "AB15 4AL",
    addresses: [
      "6 Rubislaw Den North, Aberdeen, AB15 4AL",
      "8 Rubislaw Den North, Aberdeen, AB15 4AL",
      "10 Rubislaw Den North, Aberdeen, AB15 4AL",
      "12 Rubislaw Den North, Aberdeen, AB15 4AL",
    ],
  },
  {
    postcode: "AB15 4DP",
    addresses: [
      "14 Rubislaw Park, Aberdeen, AB15 4DP",
      "16 Rubislaw Park, Aberdeen, AB15 4DP",
      "18 Rubislaw Park, Aberdeen, AB15 4DP",
    ],
  },
  {
    postcode: "AB21 9JD",
    addresses: [
      "2 Stoneywood Road, Aberdeen, AB21 9JD",
      "4 Stoneywood Road, Aberdeen, AB21 9JD",
      "6 Stoneywood Road, Aberdeen, AB21 9JD",
      "8 Stoneywood Road, Aberdeen, AB21 9JD",
    ],
  },
  {
    postcode: "AB24 3JY",
    addresses: [
      "10 Hopetoun Crescent, Aberdeen, AB24 3JY",
      "12 Hopetoun Crescent, Aberdeen, AB24 3JY",
      "14 Hopetoun Crescent, Aberdeen, AB24 3JY",
    ],
  },
  {
    postcode: "AB32 6TQ",
    addresses: [
      "Unit 2 Enterprise Drive, Westhill, AB32 6TQ",
      "Unit 4 Enterprise Drive, Westhill, AB32 6TQ",
      "Unit 6 Enterprise Drive, Westhill, AB32 6TQ",
    ],
  },
];

function normalizePostcode(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

function formatPostcode(value: string) {
  const compact = normalizePostcode(value);
  if (compact.length < 5) return compact;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

function localMatches(query: string) {
  const q = query.trim().toLowerCase();
  const compact = normalizePostcode(query);
  if (q.length < 2) return [] as Array<{ postcode: string; address: string }>;

  return LOCAL_POSTCODE_DIRECTORY.flatMap((entry) => {
    const postcodeHit =
      entry.postcode.toLowerCase().includes(q) ||
      normalizePostcode(entry.postcode).includes(compact);
    return entry.addresses
      .filter((address) => postcodeHit || address.toLowerCase().includes(q))
      .map((address) => ({ postcode: entry.postcode, address }));
  });
}

async function postcodesIoMatches(query: string) {
  const compact = normalizePostcode(query);
  if (compact.length < 2 || compact.length > 7) return [] as Array<{ postcode: string; address: string }>;

  const results: Array<{ postcode: string; address: string }> = [];

  const pushValidated = async (postcodeQuery: string) => {
    try {
      const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcodeQuery)}`, {
        headers: { Accept: "application/json" },
        next: { revalidate: 3600 },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        result?: {
          postcode?: string;
          parish?: string;
          admin_district?: string;
          admin_ward?: string;
          country?: string;
        };
      };
      const result = payload.result;
      if (!result?.postcode) return;
      const postcode = result.postcode;
      const town = result.admin_district || result.parish || "United Kingdom";
      const area = result.admin_ward || result.parish || town;
      const county = result.country || "United Kingdom";
      results.push(
        { postcode, address: `${area}, ${town}, ${postcode}` },
        { postcode, address: `Property at ${postcode}, ${town}, ${county}` },
      );
    } catch {
      // ignore individual lookup failures
    }
  };

  // Full / near-full postcode → validate directly.
  if (compact.length >= 5) {
    await pushValidated(compact);
  }

  // Partial postcode → autocomplete then validate a few suggestions.
  if (results.length === 0 && compact.length >= 2) {
    try {
      const response = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(compact)}/autocomplete`,
        { headers: { Accept: "application/json" }, next: { revalidate: 3600 } },
      );
      if (response.ok) {
        const payload = (await response.json()) as { result?: string[] | null };
        for (const suggestion of payload.result ?? []) {
          await pushValidated(suggestion);
          if (results.length >= 10) break;
        }
      }
    } catch {
      // ignore autocomplete failures
    }
  }

  return results;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = String(searchParams.get("q") || "").trim();
  if (query.length < 2) {
    return NextResponse.json({ matches: [] });
  }

  const seen = new Set<string>();
  const matches: Array<{ postcode: string; address: string }> = [];

  for (const match of [...localMatches(query), ...(await postcodesIoMatches(query))]) {
    const key = match.address.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    matches.push({
      postcode: formatPostcode(match.postcode),
      address: match.address,
    });
    if (matches.length >= 12) break;
  }

  return NextResponse.json({ matches });
}
