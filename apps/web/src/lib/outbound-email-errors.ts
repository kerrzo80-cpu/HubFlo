/** Turn raw SMTP / nodemailer errors into actionable setup guidance. */
export function formatOutboundEmailError(raw: string, provider: "Outlook" | "Gmail" | "iCloud" = "Outlook") {
  const message = raw.trim();
  if (!message) return "Email authentication or send failed.";

  if (/SmtpClientAuthentication is disabled|SmtpClientAuthenticationDisabled|535 5\.7\.139/i.test(message)) {
    return [
      "Microsoft 365 has SMTP turned off for your organisation (or this mailbox).",
      "In Microsoft 365 admin: Users → Brian → Mail → Manage email apps → tick Authenticated SMTP → Save.",
      "If that option is missing, ask your IT admin to enable SMTP AUTH for this mailbox (or tenant).",
    ].join(" ");
  }

  if (/basic authentication|basicauth|535 5\.7\.3/i.test(message) && provider === "Outlook") {
    return [
      message,
      "Microsoft may also block basic auth for SMTP. Enable Authenticated SMTP on the mailbox and confirm no auth policy blocks SMTP AUTH.",
    ].join(" — ");
  }

  if (provider === "iCloud") {
    return [
      message,
      "iCloud needs: full Apple Mail address (@icloud.com / @me.com / @mac.com), an app-specific password from appleid.apple.com (not your Apple ID password), and 2FA turned on.",
    ].join(" — ");
  }

  return message;
}
