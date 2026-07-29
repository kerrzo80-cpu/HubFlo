import { NextResponse } from "next/server";

type AddressMatch = {
  postcode: string;
  address: string;
  line1?: string;
  town?: string;
  county?: string;
};

type PostcodeMeta = {
  postcode: string;
  town: string;
  county: string;
  latitude: number;
  longitude: number;
  source: string;
};

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

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

function normalizePostcode(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

function formatPostcode(value: string) {
  const compact = normalizePostcode(value);
  if (compact.length < 5) return compact;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

function localMatches(query: string): AddressMatch[] {
  const q = query.trim().toLowerCase();
  const compact = normalizePostcode(query);
  if (q.length < 2) return [];

  return LOCAL_POSTCODE_DIRECTORY.flatMap((entry) => {
    const postcodeHit =
      entry.postcode.toLowerCase().includes(q) ||
      normalizePostcode(entry.postcode).includes(compact);
    return entry.addresses
      .filter((address) => postcodeHit || address.toLowerCase().includes(q))
      .map((address) => ({ postcode: entry.postcode, address }));
  });
}

async function validatePostcode(query: string): Promise<PostcodeMeta | null> {
  const compact = normalizePostcode(query);
  if (compact.length < 5 || compact.length > 7) return null;

  try {
    const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(compact)}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      result?: {
        postcode?: string;
        parish?: string;
        admin_district?: string;
        admin_ward?: string;
        admin_county?: string;
        country?: string;
        latitude?: number;
        longitude?: number;
      };
    };
    const result = payload.result;
    if (!result?.postcode || typeof result.latitude !== "number" || typeof result.longitude !== "number") {
      return null;
    }
    return {
      postcode: result.postcode,
      town: result.admin_district || result.parish || "",
      county: result.admin_county || result.country || "",
      latitude: result.latitude,
      longitude: result.longitude,
      source: "postcodes.io",
    };
  } catch {
    return null;
  }
}

async function autocompletePostcodes(query: string): Promise<string[]> {
  const compact = normalizePostcode(query);
  if (compact.length < 2 || compact.length > 7) return [];
  try {
    const response = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(compact)}/autocomplete`,
      { headers: { Accept: "application/json" }, next: { revalidate: 3600 } },
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as { result?: string[] | null };
    return (payload.result ?? []).slice(0, 6);
  } catch {
    return [];
  }
}

async function getAddressIoMatches(postcode: string): Promise<AddressMatch[]> {
  const apiKey = process.env.GETADDRESS_API_KEY?.trim();
  if (!apiKey) return [];

  try {
    const response = await fetch(
      `https://api.getAddress.io/find/${encodeURIComponent(normalizePostcode(postcode))}?api-key=${encodeURIComponent(apiKey)}&expand=true`,
      { headers: { Accept: "application/json" }, next: { revalidate: 3600 } },
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      postcode?: string;
      addresses?: Array<{
        formatted_address?: string[];
        line_1?: string;
        line_2?: string;
        line_3?: string;
        line_4?: string;
        town_or_city?: string;
        county?: string;
      }>;
    };
    const formattedPostcode = formatPostcode(payload.postcode || postcode);
    return (payload.addresses ?? [])
      .map((entry) => {
        const joined =
          (entry.formatted_address ?? [])
            .map((part) => part.trim())
            .filter(Boolean)
            .join(", ") ||
          [entry.line_1, entry.line_2, entry.line_3, entry.line_4, entry.town_or_city, entry.county, formattedPostcode]
            .map((part) => String(part || "").trim())
            .filter(Boolean)
            .join(", ");
        if (!joined) return null;
        return {
          postcode: formattedPostcode,
          address: joined.includes(formattedPostcode) ? joined : `${joined}, ${formattedPostcode}`,
          line1: entry.line_1 || undefined,
          town: entry.town_or_city || undefined,
          county: entry.county || undefined,
        } satisfies AddressMatch;
      })
      .filter((match): match is AddressMatch => Boolean(match));
  } catch {
    return [];
  }
}

type OsmElement = {
  tags?: Record<string, string>;
};

function formatOsmAddress(tags: Record<string, string>, fallbackPostcode: string, fallbackTown: string): AddressMatch | null {
  const housenumber = (tags["addr:housenumber"] || "").trim();
  const street = (tags["addr:street"] || "").trim();
  const housename = (tags["addr:housename"] || tags.name || "").trim();
  const unit = (tags["addr:unit"] || "").trim();
  const postcode = formatPostcode(tags["addr:postcode"] || fallbackPostcode);
  const town =
    tags["addr:city"] ||
    tags["addr:town"] ||
    tags["addr:suburb"] ||
    tags["addr:village"] ||
    fallbackTown ||
    "";
  const county = tags["addr:county"] || "";

  // Skip bare street centre-lines with no property identity.
  if (!housenumber && !housename && !unit) return null;

  const lineBits: string[] = [];
  if (housename && housename.toLowerCase() !== street.toLowerCase()) lineBits.push(housename);
  if (unit) lineBits.push(/^unit\b/i.test(unit) ? unit : `Unit ${unit}`);
  if (housenumber && street) lineBits.push(`${housenumber} ${street}`);
  else if (street) lineBits.push(street);
  else if (housenumber) lineBits.push(housenumber);

  if (lineBits.length === 0) return null;

  const line1 = lineBits.join(", ");
  const address = [line1, town, county, postcode].filter(Boolean).join(", ");
  return { postcode, address, line1, town: town || undefined, county: county || undefined };
}

async function overpassNearbyAddresses(meta: PostcodeMeta): Promise<AddressMatch[]> {
  const radius = 500;
  const query = `[out:json][timeout:25];
(
  nwr["addr:housenumber"](around:${radius},${meta.latitude},${meta.longitude});
  nwr["addr:street"](around:${radius},${meta.latitude},${meta.longitude});
  nwr["addr:postcode"="${meta.postcode}"](around:${radius + 300},${meta.latitude},${meta.longitude});
);
out tags center 100;`;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 28000);
      // Do not send Accept: application/json — overpass-api.de can respond 406.
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "NeXaHubFlo/1.0 (postcode-address-lookup)",
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timer);
      if (!response.ok) continue;
      const payload = (await response.json()) as { elements?: OsmElement[] };
      const exactCompact = normalizePostcode(meta.postcode);
      const exact: AddressMatch[] = [];
      const nearby: AddressMatch[] = [];
      const seen = new Set<string>();

      for (const element of payload.elements ?? []) {
        const match = formatOsmAddress(element.tags ?? {}, meta.postcode, meta.town);
        if (!match) continue;
        const key = match.address.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if (normalizePostcode(match.postcode) === exactCompact) exact.push(match);
        else nearby.push(match);
      }

      const combined = [...exact, ...nearby];
      if (combined.length > 0) return combined.slice(0, 20);
    } catch {
      // try next Overpass mirror
    }
  }

  return [];
}

async function nominatimFallback(meta: PostcodeMeta): Promise<AddressMatch[]> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${meta.latitude}&lon=${meta.longitude}&format=json&addressdetails=1&zoom=18`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "NeXaHubFlo/1.0 (postcode-address-lookup)",
        },
        next: { revalidate: 3600 },
      },
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      display_name?: string;
      address?: {
        building?: string;
        house_number?: string;
        road?: string;
        suburb?: string;
        village?: string;
        town?: string;
        city?: string;
        county?: string;
        state?: string;
        postcode?: string;
      };
    };
    const addr = payload.address;
    if (!addr) return [];
    const housename = (addr.building || "").trim();
    const housenumber = (addr.house_number || "").trim();
    const street = (addr.road || "").trim();
    if (!housenumber && !street && !housename) return [];
    const town = addr.town || addr.city || addr.village || addr.suburb || meta.town;
    const county = addr.county || addr.state || meta.county;
    const postcode = formatPostcode(addr.postcode || meta.postcode);
    const line1 = [housename, housenumber && street ? `${housenumber} ${street}` : street || housenumber]
      .filter(Boolean)
      .join(", ");
    const address = [line1, town, county, postcode].filter(Boolean).join(", ");
    return [{ postcode, address, line1, town, county }];
  } catch {
    return [];
  }
}

async function streetMatchesForPostcode(postcode: string): Promise<{ matches: AddressMatch[]; meta: PostcodeMeta | null }> {
  const meta = await validatePostcode(postcode);
  if (!meta) return { matches: [], meta: null };

  const paid = await getAddressIoMatches(meta.postcode);
  if (paid.length > 0) {
    return { matches: paid, meta: { ...meta, source: "getAddress.io" } };
  }

  const osm = await overpassNearbyAddresses(meta);
  if (osm.length > 0) {
    const townFromStreets = osm.find((match) => match.town?.trim())?.town?.trim();
    return {
      matches: osm,
      meta: {
        ...meta,
        town: townFromStreets || meta.town,
        source: "openstreetmap",
      },
    };
  }

  const nominatim = await nominatimFallback(meta);
  return {
    matches: nominatim,
    meta: {
      ...meta,
      town: nominatim.find((match) => match.town?.trim())?.town?.trim() || meta.town,
      source: nominatim.length ? "nominatim" : meta.source,
    },
  };
}

function dedupeMatches(matches: AddressMatch[], limit = 12): AddressMatch[] {
  const seen = new Set<string>();
  const output: AddressMatch[] = [];
  for (const match of matches) {
    const key = match.address.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    // Never invent generic area placeholders as selectable addresses.
    if (/^property at\b/i.test(match.address) || /^area around\b/i.test(match.address)) continue;
    seen.add(key);
    output.push({
      postcode: formatPostcode(match.postcode),
      address: match.address,
      line1: match.line1,
      town: match.town,
      county: match.county,
    });
    if (output.length >= limit) break;
  }
  return output;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = String(searchParams.get("q") || "").trim();
  if (query.length < 2) {
    return NextResponse.json({ matches: [], meta: null });
  }

  const local = localMatches(query);
  if (local.length > 0) {
    return NextResponse.json({
      matches: dedupeMatches(local),
      meta: {
        postcode: formatPostcode(local[0].postcode),
        town: "",
        county: "",
        latitude: 0,
        longitude: 0,
        source: "local",
      } satisfies PostcodeMeta,
    });
  }

  const compact = normalizePostcode(query);
  let meta: PostcodeMeta | null = null;
  let matches: AddressMatch[] = [];

  if (compact.length >= 5) {
    const resolved = await streetMatchesForPostcode(query);
    meta = resolved.meta;
    matches = resolved.matches;
  }

  // Partial postcode: suggest completed postcodes' street lists (first few).
  if (matches.length === 0 && compact.length >= 2 && compact.length < 7) {
    const suggestions = await autocompletePostcodes(query);
    for (const suggestion of suggestions) {
      const resolved = await streetMatchesForPostcode(suggestion);
      if (!meta && resolved.meta) meta = resolved.meta;
      matches.push(...resolved.matches);
      if (matches.length >= 12) break;
    }
  }

  return NextResponse.json({
    matches: dedupeMatches(matches),
    meta,
  });
}
