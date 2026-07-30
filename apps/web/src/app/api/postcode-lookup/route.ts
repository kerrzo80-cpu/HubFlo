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
  {
    postcode: "AB12 4TG",
    addresses: [
      "1 Hillside Drive, Portlethen, AB12 4TG",
      "2 Hillside Drive, Portlethen, AB12 4TG",
      "3 Hillside Drive, Portlethen, AB12 4TG",
      "4 Hillside Drive, Portlethen, AB12 4TG",
      "5 Hillside Drive, Portlethen, AB12 4TG",
      "6 Hillside Drive, Portlethen, AB12 4TG",
      "7 Hillside Drive, Portlethen, AB12 4TG",
      "8 Hillside Drive, Portlethen, AB12 4TG",
      "9 Hillside Drive, Portlethen, AB12 4TG",
      "10 Hillside Drive, Portlethen, AB12 4TG",
      "11 Hillside Drive, Portlethen, AB12 4TG",
      "12 Hillside Drive, Portlethen, AB12 4TG",
      "14 Hillside Drive, Portlethen, AB12 4TG",
      "15 Hillside Drive, Portlethen, AB12 4TG",
      "16 Hillside Drive, Portlethen, AB12 4TG",
      "17 Hillside Drive, Portlethen, AB12 4TG",
      "18 Hillside Drive, Portlethen, AB12 4TG",
      "19 Hillside Drive, Portlethen, AB12 4TG",
      "20 Hillside Drive, Portlethen, AB12 4TG",
      "21 Hillside Drive, Portlethen, AB12 4TG",
      "22 Hillside Drive, Portlethen, AB12 4TG",
      "23 Hillside Drive, Portlethen, AB12 4TG",
      "24 Hillside Drive, Portlethen, AB12 4TG",
      "25 Hillside Drive, Portlethen, AB12 4TG",
      "26 Hillside Drive, Portlethen, AB12 4TG",
      "27 Hillside Drive, Portlethen, AB12 4TG",
      "28 Hillside Drive, Portlethen, AB12 4TG",
      "29 Hillside Drive, Portlethen, AB12 4TG",
      "30 Hillside Drive, Portlethen, AB12 4TG",
      "31 Hillside Drive, Portlethen, AB12 4TG",
      "32 Hillside Drive, Portlethen, AB12 4TG",
      "33 Hillside Drive, Portlethen, AB12 4TG",
      "34 Hillside Drive, Portlethen, AB12 4TG",
      "35 Hillside Drive, Portlethen, AB12 4TG",
      "36 Hillside Drive, Portlethen, AB12 4TG",
      "37 Hillside Drive, Portlethen, AB12 4TG",
      "38 Hillside Drive, Portlethen, AB12 4TG",
      "39 Hillside Drive, Portlethen, AB12 4TG",
      "40 Hillside Drive, Portlethen, AB12 4TG",
      "41 Hillside Drive, Portlethen, AB12 4TG",
      "42 Hillside Drive, Portlethen, AB12 4TG",
      "43 Hillside Drive, Portlethen, AB12 4TG",
      "44 Hillside Drive, Portlethen, AB12 4TG",
      "45 Hillside Drive, Portlethen, AB12 4TG",
      "46 Hillside Drive, Portlethen, AB12 4TG",
      "47 Hillside Drive, Portlethen, AB12 4TG",
      "48 Hillside Drive, Portlethen, AB12 4TG",
      "49 Hillside Drive, Portlethen, AB12 4TG",
      "50 Hillside Drive, Portlethen, AB12 4TG",
      "51 Hillside Drive, Portlethen, AB12 4TG",
      "52 Hillside Drive, Portlethen, AB12 4TG",
      "54 Hillside Drive, Portlethen, AB12 4TG",
    ],
  },
];

const FULL_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/i;
/** Keep the whole route under ~7s — Ideal Postcodes + OSM fallbacks need room on Render. */
const ROUTE_BUDGET_MS = 7000;

function normalizePostcode(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

function formatPostcode(value: string) {
  const compact = normalizePostcode(value);
  if (compact.length < 5) return compact;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

function isFullPostcode(value: string) {
  return FULL_POSTCODE_RE.test(normalizePostcode(value));
}

function compactMatches(rows: Array<AddressMatch | null | undefined>): AddressMatch[] {
  return rows.filter((match): match is AddressMatch => Boolean(match?.address && match.postcode));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function localMatches(query: string): AddressMatch[] {
  const q = query.trim().toLowerCase();
  const compact = normalizePostcode(query);
  if (q.length < 2) return [];

  // Exact postcode first so seeded streets (e.g. AB12 4TG) always win over remote single-hit fallbacks.
  if (isFullPostcode(query)) {
    const exact = LOCAL_POSTCODE_DIRECTORY.find((entry) => normalizePostcode(entry.postcode) === compact);
    if (exact) {
      return exact.addresses.map((address) => ({ postcode: exact.postcode, address }));
    }
  }

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
  if (!isFullPostcode(query)) return null;

  try {
    const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(normalizePostcode(query))}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(1200),
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      result?: {
        postcode?: string;
        parish?: string;
        admin_district?: string;
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

async function getAddressIoMatches(postcode: string): Promise<AddressMatch[]> {
  const apiKey = process.env.GETADDRESS_API_KEY?.trim();
  if (!apiKey) return [];

  try {
    const response = await fetch(
      `https://api.getAddress.io/find/${encodeURIComponent(normalizePostcode(postcode))}?api-key=${encodeURIComponent(apiKey)}&expand=true`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(2500),
        next: { revalidate: 3600 },
      },
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      postcode?: string;
      addresses?: Array<{
        formatted_address?: string[];
        line_1?: string;
        town_or_city?: string;
        county?: string;
      }>;
    };
    const formattedPostcode = formatPostcode(payload.postcode || postcode);
    return compactMatches(
      (payload.addresses ?? []).map((entry) => {
        const joined =
          (entry.formatted_address ?? []).map((part) => part.trim()).filter(Boolean).join(", ") ||
          [entry.line_1, entry.town_or_city, entry.county, formattedPostcode]
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
        };
      }),
    );
  } catch {
    return [];
  }
}

/** UK PAF street list via Ideal Postcodes (primary internet lookup). */
async function idealPostcodesMatches(postcode: string): Promise<AddressMatch[]> {
  const apiKey =
    process.env.IDEAL_POSTCODES_API_KEY?.trim() ||
    process.env.IDEALPOSTCODES_API_KEY?.trim() ||
    // Sandbox key — returns live PAF samples; replace with a real key in Render for production limits.
    "ak_test";

  try {
    const response = await fetch(
      `https://api.ideal-postcodes.co.uk/v1/postcodes/${encodeURIComponent(formatPostcode(postcode))}?api_key=${encodeURIComponent(apiKey)}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(3500),
        cache: "no-store",
      },
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      result?: Array<{
        postcode?: string;
        line_1?: string;
        line_2?: string;
        line_3?: string;
        post_town?: string;
        county?: string;
        building_number?: string;
        thoroughfare?: string;
      }>;
    };
    const rows = payload.result ?? [];
    return compactMatches(
      rows.map((row) => {
        const formattedPostcode = formatPostcode(row.postcode || postcode);
        const line1 =
          [row.line_1, row.line_2, row.line_3].map((part) => String(part || "").trim()).filter(Boolean).join(", ") ||
          [row.building_number, row.thoroughfare].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
        if (!line1) return null;
        const town = (row.post_town || "").trim();
        const county = (row.county || "").trim();
        const address = [line1, town, county, formattedPostcode].filter(Boolean).join(", ");
        return {
          postcode: formattedPostcode,
          address,
          line1,
          town: town || undefined,
          county: county || undefined,
        };
      }),
    );
  } catch {
    return [];
  }
}

type OsmElement = {
  tags?: Record<string, string>;
};

function splitHouseNumbers(raw: string): string[] {
  const value = raw.trim();
  if (!value) return [];
  if (!/[,\-\/&]/.test(value) && !/\d+\s+\d+/.test(value)) return [value];
  // OSM sometimes stores "30,32,34,36" on one node — expand into selectable addresses.
  const parts = value
    .split(/[,&]|\/|\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const expanded: string[] = [];
  for (const part of parts) {
    const range = part.match(/^(\d+)\s*[-–]\s*(\d+)([A-Za-z]?)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const suffix = range[3] || "";
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 40) {
        for (let n = start; n <= end; n += 1) expanded.push(`${n}${suffix}`);
        continue;
      }
    }
    expanded.push(part);
  }
  return expanded.length ? expanded : [value];
}

function formatOsmAddress(tags: Record<string, string>, fallbackPostcode: string, fallbackTown: string): AddressMatch[] {
  const housenumberRaw = (tags["addr:housenumber"] || "").trim();
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

  if (!housenumberRaw && !housename && !unit) return [];

  const numbers = splitHouseNumbers(housenumberRaw);
  const targets = numbers.length ? numbers : [""];

  return compactMatches(
    targets.map((housenumber) => {
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
    }),
  );
}

/** Race Overpass mirrors in parallel — Render often times out on a single slow mirror. */
async function runOverpassQuery(query: string, timeoutMs: number): Promise<OsmElement[]> {
  const endpoints = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
  ];

  const attempts = endpoints.map(async (endpoint) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": "NeXaHubFlo/1.0 (postcode-address-lookup)",
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`overpass ${response.status}`);
    const payload = (await response.json()) as { elements?: OsmElement[] };
    const elements = payload.elements ?? [];
    if (elements.length === 0) throw new Error("overpass empty");
    return elements;
  });

  try {
    return await Promise.any(attempts);
  } catch {
    return [];
  }
}

function houseNumberSortKey(value: string | undefined) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d+)/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]);
}

function matchesFromOsmElements(
  elements: OsmElement[],
  meta: PostcodeMeta,
): AddressMatch[] {
  const exactCompact = normalizePostcode(meta.postcode);
  const exact: AddressMatch[] = [];
  const nearby: AddressMatch[] = [];
  const seen = new Set<string>();

  for (const element of elements) {
    for (const match of formatOsmAddress(element.tags ?? {}, meta.postcode, meta.town)) {
      const key = match.address.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (normalizePostcode(match.postcode) === exactCompact) exact.push(match);
      else nearby.push(match);
    }
  }

  const byHouseNumber = (a: AddressMatch, b: AddressMatch) => {
    const aNum = houseNumberSortKey(a.line1);
    const bNum = houseNumberSortKey(b.line1);
    if (aNum !== bNum) return aNum - bNum;
    return a.address.localeCompare(b.address);
  };

  return [...exact.sort(byHouseNumber), ...nearby.sort(byHouseNumber)].slice(0, 60);
}

async function overpassNearbyAddresses(meta: PostcodeMeta, streetHint = ""): Promise<AddressMatch[]> {
  // Exact postcode match is fast and returns the full street when OSM has it mapped.
  const exactQuery = `[out:json][timeout:8];nwr["addr:postcode"="${meta.postcode}"];out tags 120;`;
  let elements = await runOverpassQuery(exactQuery, 2800);

  if (elements.length < 3 && streetHint) {
    const escapedStreet = streetHint.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const streetQuery = `[out:json][timeout:8];
(
  nwr["addr:street"="${escapedStreet}"](around:700,${meta.latitude},${meta.longitude});
  nwr["addr:housenumber"](around:250,${meta.latitude},${meta.longitude});
);
out tags center 120;`;
    const more = await runOverpassQuery(streetQuery, 2200);
    elements = [...elements, ...more];
  } else if (elements.length < 3) {
    const aroundQuery = `[out:json][timeout:6];
nwr["addr:housenumber"](around:300,${meta.latitude},${meta.longitude});
out tags center 80;`;
    const more = await runOverpassQuery(aroundQuery, 1800);
    elements = [...elements, ...more];
  }

  return matchesFromOsmElements(elements, meta);
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
        signal: AbortSignal.timeout(1200),
        next: { revalidate: 3600 },
      },
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as {
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

  // Prefer Ideal Postcodes / getAddress PAF lists — OSM coverage is patchy for many UK streets.
  const ideal = await idealPostcodesMatches(meta.postcode);
  if (ideal.length > 0) {
    return { matches: ideal, meta: { ...meta, source: "ideal-postcodes" } };
  }

  const paid = await getAddressIoMatches(meta.postcode);
  if (paid.length > 0) {
    return { matches: paid, meta: { ...meta, source: "getAddress.io" } };
  }

  // Exact postcode OSM list first — this is what returns every house on the street.
  const osm = await withTimeout(overpassNearbyAddresses(meta), 3500, [] as AddressMatch[]);
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

  // If OSM postcode query was empty, use reverse geocode then retry with street name.
  const nominatim = await withTimeout(nominatimFallback(meta), 1200, [] as AddressMatch[]);
  const streetHint =
    nominatim[0]?.line1?.replace(/^\d+\s+/, "").split(",")[0]?.trim() ||
    "";
  if (streetHint) {
    const byStreet = await withTimeout(overpassNearbyAddresses(meta, streetHint), 2500, [] as AddressMatch[]);
    if (byStreet.length > 0) {
      return {
        matches: byStreet,
        meta: {
          ...meta,
          town: byStreet.find((match) => match.town?.trim())?.town?.trim() || meta.town,
          source: "openstreetmap",
        },
      };
    }
  }

  return {
    matches: nominatim,
    meta: {
      ...meta,
      town: nominatim.find((match) => match.town?.trim())?.town?.trim() || meta.town,
      source: nominatim.length ? "nominatim" : meta.source,
    },
  };
}

function dedupeMatches(matches: AddressMatch[], limit = 60): AddressMatch[] {
  const seen = new Set<string>();
  const output: AddressMatch[] = [];
  for (const match of matches) {
    const key = match.address.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
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

  // Full UK postcode: prefer live PAF/OSM so Blake always searches the internet.
  if (isFullPostcode(query)) {
    const resolved = await withTimeout(
      streetMatchesForPostcode(query),
      ROUTE_BUDGET_MS,
      { matches: [] as AddressMatch[], meta: null as PostcodeMeta | null },
    );

    let meta = resolved.meta;
    let matches = resolved.matches;
    if (!meta) {
      meta = await withTimeout(validatePostcode(query), 900, null);
    }
    if (matches.length === 0) {
      matches = localMatches(query);
      if (matches.length > 0) {
        meta = {
          postcode: formatPostcode(matches[0]!.postcode),
          town: meta?.town || "",
          county: meta?.county || "",
          latitude: meta?.latitude || 0,
          longitude: meta?.longitude || 0,
          source: "local",
        };
      }
    }

    return NextResponse.json({
      matches: dedupeMatches(matches),
      meta,
    });
  }

  const local = localMatches(query);
  if (local.length > 0) {
    const first = local[0]!;
    return NextResponse.json({
      matches: dedupeMatches(local),
      meta: {
        postcode: formatPostcode(first.postcode),
        town: "",
        county: "",
        latitude: 0,
        longitude: 0,
        source: "local",
      } satisfies PostcodeMeta,
    });
  }

  return NextResponse.json({ matches: [], meta: null, incomplete: true });
}
