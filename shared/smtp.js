// Minimal SMTP client for Cloudflare Workers (TCP sockets), used to send
// sign-in codes through a Gmail account with an App Password.
// Gmail: smtp.gmail.com port 465 (TLS from the start), AUTH PLAIN.
//
// `connect` is Cloudflare's connect() from "cloudflare:sockets", passed in
// by worker/index.js so this file also runs in tests with a fake server.

export class SmtpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // SMTP reply code (e.g. 535) or 0 for connection problems
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CRLF = "\r\n";

const b64 = (text) => {
  const bytes = encoder.encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
// Base64 wrapped at 76 characters, as MIME requires. Base64 never contains
// ".", so no line can start with a dot (no SMTP dot-stuffing needed).
const b64Lines = (text) => b64(text).replace(/.{1,76}/g, (line) => line + CRLF);

// Header values: encode non-ASCII as RFC 2047 and never allow line breaks.
const header = (value) => {
  const flat = String(value).replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(flat) ? flat : `=?UTF-8?B?${b64(flat)}?=`;
};

const ADDRESS = /^[^\s<>@,;:"]+@[^\s<>@,;:"]+\.[^\s<>@,;:"]+$/;
function checkAddress(address) {
  if (!ADDRESS.test(String(address))) throw new SmtpError(0, "Invalid email address.");
  return address;
}

/** Builds the full message (headers + multipart/alternative body). */
export function buildMessage({ fromName, fromAddress, to, subject, text, html, domain, now = new Date() }) {
  const boundary = `dc-${crypto.randomUUID()}`;
  const lines = [
    `From: ${header(fromName)} <${fromAddress}>`,
    `To: <${to}>`,
    `Subject: ${header(subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(text).trimEnd(),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(html).trimEnd(),
    `--${boundary}--`,
    "",
  ];
  return lines.join(CRLF);
}

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new SmtpError(0, `Mail server timed out (${what}).`)), ms);
    }),
  ]);
}

/**
 * Sends one email over SMTP with implicit TLS.
 * @returns {Promise<void>} resolves when the server accepted the message.
 */
export async function sendSmtp({
  connect,
  host = "smtp.gmail.com",
  port = 465,
  username,
  password,
  fromName = "DataChat",
  to,
  subject,
  text,
  html,
  heloName = "datachat.harmongt.uk",
  timeoutMs = 15000,
}) {
  if (typeof connect !== "function") throw new SmtpError(0, "Outgoing mail connections are not available.");
  checkAddress(username);
  checkAddress(to);

  const socket = connect({ hostname: host, port }, { secureTransport: "on", allowHalfOpen: false });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  let buffer = "";

  // Reads one complete (possibly multi-line) reply: "250-..." lines then "250 ...".
  async function reply(what) {
    for (;;) {
      const lines = buffer.split(CRLF);
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
          const text = lines.slice(0, i + 1).join("\n");
          buffer = lines.slice(i + 1).join(CRLF);
          return { code: Number(lines[i].slice(0, 3)), text };
        }
      }
      const { value, done } = await withTimeout(reader.read(), timeoutMs, what);
      if (done) throw new SmtpError(0, `Mail server closed the connection (${what}).`);
      buffer += decoder.decode(value, { stream: true });
    }
  }
  async function expect(what, ...codes) {
    const r = await reply(what);
    if (!codes.includes(r.code)) throw new SmtpError(r.code, `Mail server refused ${what}: ${r.text.split("\n").pop()}`);
    return r;
  }
  const send = (line) => withTimeout(writer.write(encoder.encode(line + CRLF)), timeoutMs, "write");

  try {
    await expect("greeting", 220);
    await send(`EHLO ${heloName}`);
    await expect("EHLO", 250);
    await send(`AUTH PLAIN ${b64(`\0${username}\0${password}`)}`);
    await expect("sign-in", 235);
    await send(`MAIL FROM:<${username}>`);
    await expect("sender", 250);
    await send(`RCPT TO:<${to}>`);
    await expect("recipient", 250, 251);
    await send("DATA");
    await expect("DATA", 354);
    const message = buildMessage({ fromName, fromAddress: username, to, subject, text, html, domain: heloName });
    await withTimeout(writer.write(encoder.encode(message + CRLF + "." + CRLF)), timeoutMs, "message");
    await expect("message", 250);
    await send("QUIT").catch(() => {});
  } finally {
    try {
      reader.releaseLock();
      writer.releaseLock();
      await socket.close();
    } catch {
      /* already closed */
    }
  }
}
