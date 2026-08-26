# NeXa AWS staging (no production cutover)

This folder scaffolds a **staging-only** AWS footprint. Render `nexa-live` stays the production fallback.

## Target shape

| Resource | Starter choice |
|----------|----------------|
| App | Lightsail 4 GB Linux (Node 24) |
| Database | Lightsail managed PostgreSQL 2 GB |
| Files | Private S3 bucket `nexa-staging-files` |
| Secrets | Secrets Manager / SSM SecureString |
| Region | `eu-west-2` (London) or `eu-central-1` (Frankfurt) |
| DNS | Staging hostname only — **do not** change the live domain |

## Prerequisites

1. AWS account with billing enabled
2. IAM user/role able to create Lightsail, S3, Secrets Manager
3. AWS CLI configured (`aws configure` or instance role)
4. A copy of production SQLite + `/var/data` files for ETL rehearsal (never point staging at live Render disk)

## Bootstrap (manual first pass)

```bash
# 1) Create S3 bucket (private)
aws s3api create-bucket \
  --bucket nexa-staging-files-<your-suffix> \
  --region eu-west-2 \
  --create-bucket-configuration LocationConstraint=eu-west-2
aws s3api put-public-access-block \
  --bucket nexa-staging-files-<your-suffix> \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning \
  --bucket nexa-staging-files-<your-suffix> \
  --versioning-configuration Status=Enabled

# 2) Create Lightsail PostgreSQL (console or CLI) — 2 GB Standard
# 3) Create Lightsail 4 GB instance; open HTTPS; install Node 24 + pnpm
# 4) Store secrets (examples)
aws secretsmanager create-secret --name nexa/staging/openai --secret-string '{"OPENAI_API_KEY":"..."}'
aws secretsmanager create-secret --name nexa/staging/database --secret-string '{"DATABASE_URL":"postgresql://..."}'
```

Helper scripts in this folder:

- `scripts/staging-env.example` — env template for the Lightsail app
- `../migrate/export-sqlite-inventory.mjs` — list SQLite store keys + sizes
- `../migrate/etl-sqlite-to-postgres.md` — ETL runbook

## App env on staging

Copy `scripts/staging-env.example` to the server as `.env` (never commit secrets).

Critical differences from Render live:

- `DATABASE_URL` set (Postgres)
- `NEXA_STORE_PATH` empty once Postgres is primary (transitional dual-run may keep a local SQLite mirror)
- `NEXA_FILES_BUCKET` + AWS region for S3
- `NEXA_AUTH_MODE=users`
- OpenAI / simPRO / Xero secrets from Secrets Manager — **not** SQLite

## Heap

On a 4 GB Lightsail host use:

```bash
NODE_OPTIONS=--max-old-space-size=2048
```

Do **not** use 3072 on a 512 MB Render starter.

## Safety

- No DNS cutover from this staging stack
- Do not delete Render disks/services
- Rotate any secrets copied from production after staging import
