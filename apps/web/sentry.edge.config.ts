import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NEXA_ENVIRONMENT || process.env.NODE_ENV,
  release: process.env.RENDER_GIT_COMMIT,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.2"),
  sendDefaultPii: false,
  enabled: Boolean(process.env.SENTRY_DSN),
});
