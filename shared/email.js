// Branded transactional emails. Built for email clients: table layout and
// inline styles only (no external CSS, no web fonts required), with a
// plain-text alternative. Colours match the app (src/styles.css :root).

const BRAND = {
  bg: "#07101f",
  card: "#0e192b",
  card2: "#111f34",
  border: "#24334b",
  text: "#f5f7fa",
  muted: "#91a0b6",
  gold: "#d7a62b",
  gold2: "#f1c34f",
};
const SANS = "'Fira Sans', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'Fira Code', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace";

export const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Where a request came from, from Cloudflare's request.cf, e.g. "Dubai, AE". */
export function requestLocation(cf) {
  if (!cf) return "";
  return [cf.city, cf.country].filter((part) => typeof part === "string" && part.trim()).join(", ").slice(0, 80);
}

/**
 * Sign-in code email.
 * @param {{ code: string, appUrl: string, location?: string, minutes?: number }} options
 */
export function loginCodeEmail({ code, appUrl, location = "", minutes = 10 }) {
  const site = String(appUrl || "https://datachat.harmongt.uk").replace(/\/$/, "");
  const host = site.replace(/^https?:\/\//, "");
  const where = location ? `Requested from ${location}. ` : "";
  const subject = `${code} is your DataChat sign-in code`;

  const text = [
    "DataChat sign-in code",
    "",
    code,
    "",
    `Enter this code in DataChat to sign in. It expires in ${minutes} minutes and works once.`,
    "",
    `${where}If you didn't try to sign in, ignore this email. Nobody can get into your account without the code.`,
    "Never share this code. DataChat will never ask you for it.",
    "",
    `DataChat · Private financial community · ${host}`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};" bgcolor="${BRAND.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BRAND.bg};">Your code expires in ${minutes} minutes. Never share it with anyone.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.bg}" style="background:${BRAND.bg};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        <tr>
          <td style="padding:0 4px 20px 4px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle;"><img src="${site}/assets/email-logo.png" width="40" height="40" alt="" style="display:block;border:0;border-radius:10px;"></td>
                <td style="vertical-align:middle;padding-left:12px;font-family:${SANS};font-size:20px;font-weight:700;color:${BRAND.text};">DataChat</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td bgcolor="${BRAND.card}" style="background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:16px;padding:36px 32px;">
            <p style="margin:0 0 10px 0;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BRAND.gold};">Sign-in code</p>
            <h1 style="margin:0 0 12px 0;font-family:${SANS};font-size:24px;line-height:1.3;font-weight:700;color:${BRAND.text};">Confirm it's you</h1>
            <p style="margin:0 0 24px 0;font-family:${SANS};font-size:15px;line-height:1.6;color:${BRAND.muted};">Enter this code in DataChat to sign in. It expires in ${minutes} minutes and works once.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="${BRAND.card2}" style="background:${BRAND.card2};border:1px solid ${BRAND.border};border-radius:12px;padding:20px 12px;font-family:${MONO};font-size:34px;line-height:1;font-weight:700;letter-spacing:10px;color:${BRAND.gold2};">${escapeHtml(code)}</td>
              </tr>
            </table>
            <p style="margin:24px 0 0 0;font-family:${SANS};font-size:14px;line-height:1.6;color:${BRAND.muted};">${escapeHtml(where)}If you didn't try to sign in, ignore this email. Nobody can get into your account without the code.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
              <tr>
                <td style="border-top:1px solid ${BRAND.border};padding-top:16px;font-family:${SANS};font-size:13px;line-height:1.6;color:${BRAND.muted};">
                  <span style="color:${BRAND.gold};font-weight:700;">Never share this code.</span> DataChat will never ask you for it by phone, chat or email.
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:20px 4px 0 4px;font-family:${SANS};font-size:12px;line-height:1.6;color:${BRAND.muted};">
            DataChat · Private financial community<br>
            <a href="${site}" style="color:${BRAND.muted};text-decoration:underline;">${escapeHtml(host)}</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}
