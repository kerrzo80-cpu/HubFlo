import { createHmac, createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";

export type OfficeBackupS3Result = {
  uploaded: boolean;
  key?: string;
  error?: string;
};

function env(name: string, fallbackNames: string[] = []) {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  for (const other of fallbackNames) {
    const value = process.env[other]?.trim();
    if (value) return value;
  }
  return "";
}

export function officeBackupS3Config() {
  const bucket = env("BACKUP_S3_BUCKET", ["AWS_S3_BUCKET", "S3_BUCKET"]);
  const accessKeyId = env("BACKUP_S3_ACCESS_KEY_ID", ["AWS_ACCESS_KEY_ID"]);
  const secretAccessKey = env("BACKUP_S3_SECRET_ACCESS_KEY", ["AWS_SECRET_ACCESS_KEY"]);
  const region = env("BACKUP_S3_REGION", ["AWS_REGION", "AWS_DEFAULT_REGION"]) || "eu-west-2";
  const endpoint = env("BACKUP_S3_ENDPOINT", ["AWS_S3_ENDPOINT"]);
  const prefix = env("BACKUP_S3_PREFIX", ["AWS_S3_PREFIX"]);
  return { bucket, accessKeyId, secretAccessKey, region, endpoint, prefix };
}

export function officeBackupS3Configured() {
  const config = officeBackupS3Config();
  return Boolean(config.bucket && config.accessKeyId && config.secretAccessKey);
}

export function officeBackupS3ObjectKey(input: { workspace: string; filename: string }) {
  const config = officeBackupS3Config();
  const prefix = (config.prefix || `nexa/${input.workspace}`).replace(/^\/+|\/+$/g, "");
  return `${prefix}/${input.filename}`;
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function amzDate(at: Date) {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeS3Key(key: string) {
  return key
    .split("/")
    .map((part) => encodeRfc3986(part))
    .join("/");
}

export function buildOfficeBackupS3PutRequest(input: {
  key: string;
  contentLength: number;
  at?: Date;
}) {
  const config = officeBackupS3Config();
  const at = input.at ?? new Date();
  const dateStamp = amzDate(at).slice(0, 8);
  const amz = amzDate(at);
  const payloadHash = "UNSIGNED-PAYLOAD";
  const host = config.endpoint
    ? new URL(config.endpoint).host
    : `${config.bucket}.s3.${config.region}.amazonaws.com`;
  const url = config.endpoint
    ? `${config.endpoint.replace(/\/$/, "")}/${config.bucket}/${encodeS3Key(input.key)}`
    : `https://${host}/${encodeS3Key(input.key)}`;
  const canonicalUri = config.endpoint ? `/${config.bucket}/${encodeS3Key(input.key)}` : `/${encodeS3Key(input.key)}`;
  const headersToSign: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amz,
  };
  const signedHeaderNames = Object.keys(headersToSign).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headersToSign[name]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amz,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), config.region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  return {
    url,
    headers: {
      ...headersToSign,
      "content-length": String(input.contentLength),
      authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

export async function uploadOfficeBackupToS3(input: {
  filePath: string;
  filename: string;
  workspace: string;
}): Promise<OfficeBackupS3Result> {
  if (!officeBackupS3Configured()) {
    return { uploaded: false, error: "not-configured" };
  }
  const key = officeBackupS3ObjectKey({ workspace: input.workspace, filename: input.filename });
  try {
    const contentLength = statSync(input.filePath).size;
    const request = buildOfficeBackupS3PutRequest({ key, contentLength });
    const body = createReadStream(input.filePath);
    const response = await fetch(request.url, {
      method: "PUT",
      headers: request.headers,
      body: body as unknown as ReadableStream,
      // @ts-expect-error Node fetch needs duplex for streamed PUT bodies
      duplex: "half",
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        uploaded: false,
        key,
        error: `S3 ${response.status} ${text.slice(0, 240) || response.statusText}`,
      };
    }
    return { uploaded: true, key };
  } catch (error) {
    return {
      uploaded: false,
      key,
      error: error instanceof Error ? error.message : "S3 upload failed",
    };
  }
}
