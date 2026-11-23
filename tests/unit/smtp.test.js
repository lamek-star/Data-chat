import { describe, expect, it } from "vitest";
import { buildMessage, sendSmtp, SmtpError } from "../../shared/smtp.js";
import { call, makeEnv } from "./helpers.js";

// A scripted fake SMTP server behind a fake Cloudflare connect().
function fakeSmtpServer({ replies = {}, silent = false } = {}) {
  const log = { commands: [], data: "", connectedTo: null, options: null };
  let push;
  const readable = new ReadableStream({ start: (controller) => (push = (line) => controller.enqueue(new TextEncoder().encode(line))) });
  let pending = "";
  let inData = false;
  const respond = (command) => {
    const verb = command.split(" ")[0].replace(/:.*/, "").toUpperCase();
    if (replies[verb]) return push(replies[verb]);
    if (verb === "EHLO") return push("250-smtp.fake.test at your service\r\n250-AUTH LOGIN PLAIN\r\n250 SMTPUTF8\r\n");
    if (verb === "AUTH") return push("235 2.7.0 Accepted\r\n");
    if (verb === "MAIL" || verb === "RCPT") return push("250 2.1.0 OK\r\n");
    if (verb === "DATA") return push("354 Go ahead\r\n");
    if (verb === "QUIT") return push("221 Bye\r\n");
    return push("502 Unknown\r\n");
  };
  const writable = new WritableStream({
    write(chunk) {
      pending += new TextDecoder().decode(chunk);
      for (;;) {
        if (inData) {
          const end = pending.indexOf("\r\n.\r\n");
          if (end < 0) return;
          log.data = pending.slice(0, end);
          pending = pending.slice(end + 5);
          inData = false;
          push(replies.MESSAGE || "250 2.0.0 OK queued\r\n");
          continue;
        }
        const nl = pending.indexOf("\r\n");
        if (nl < 0) return;
        const command = pending.slice(0, nl);
        pending = pending.slice(nl + 2);
        log.commands.push(command);
        if (!silent) respond(command);
        if (command === "DATA" && !replies.DATA) inData = true;
      }
    },
  });
  const connect = (address, options) => {
    log.connectedTo = address;
    log.options = options;
    if (!silent) push(replies.GREETING || "220 smtp.fake.test ESMTP ready\r\n");
    return { readable, writable, close: async () => {} };
  };
  return { connect, log };
}

const decodePart = (data, type) => {
  const part = data.split(/--dc-[0-9a-f-]+/).find((p) => p.includes(`Content-Type: ${type}`));
  const body = part.split("\r\n\r\n")[1].replace(/\s+/g, "");
  return new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0)));
};

const base = { username: "owner@example.test", password: "abcdefghijklmnop", to: "ana@example.test", subject: "12345678 is your DataChat sign-in code", text: "Your code is 12345678", html: "<p>Your code is <b>12345678</b></p>" };

describe("SMTP client", () => {
  it("connects to Gmail over TLS on port 465 and runs the full conversation", async () => {
    const server = fakeSmtpServer();
    await sendSmtp({ ...base, connect: server.connect });
    expect(server.log.connectedTo).toEqual({ hostname: "smtp.gmail.com", port: 465 });
    expect(server.log.options.secureTransport).toBe("on");
    expect(server.log.commands.map((c) => c.split(" ")[0])).toEqual(["EHLO", "AUTH", "MAIL", "RCPT", "DATA", "QUIT"]);
    const auth = atob(server.log.commands[1].split(" ")[2]);
    expect(auth).toBe("\0owner@example.test\0abcdefghijklmnop");
    expect(server.log.commands[2]).toBe("MAIL FROM:<owner@example.test>");
    expect(server.log.commands[3]).toBe("RCPT TO:<ana@example.test>");
  });

  it("sends a proper MIME message with text and HTML parts", async () => {
    const server = fakeSmtpServer();
    await sendSmtp({ ...base, connect: server.connect });
    const message = server.log.data;
    expect(message).toMatch(/^From: DataChat <owner@example\.test>\r\n/);
    expect(message).toContain("To: <ana@example.test>\r\n");
    expect(message).toContain("Subject: 12345678 is your DataChat sign-in code\r\n");
    expect(message).toContain("MIME-Version: 1.0");
    expect(decodePart(message, "text/plain")).toBe("Your code is 12345678");
    expect(decodePart(message, "text/html")).toBe("<p>Your code is <b>12345678</b></p>");
    expect(message.split("\r\n").every((line) => line.length <= 998)).toBe(true);
    expect(message.split("\r\n").some((line) => line.startsWith("."))).toBe(false);
  });

  it("keeps headers on one line and encodes non-ASCII text", () => {
    const message = buildMessage({ fromName: "DataChat ሰላም", fromAddress: "a@b.co", to: "c@d.co", subject: "Hi\r\nBcc: evil@x.co", text: "t", html: "h", domain: "x.test" });
    expect(message).not.toMatch(/^Bcc:/m);
    expect(message).toContain("Subject: Hi Bcc: evil@x.co");
    expect(message).toMatch(/^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <a@b\.co>/m);
  });

  it("refuses addresses that could inject SMTP commands", async () => {
    const server = fakeSmtpServer();
    await expect(sendSmtp({ ...base, to: "ana@example.test>\r\nRCPT TO:<evil@x.co", connect: server.connect })).rejects.toThrow(/Invalid email/);
    expect(server.log.commands).toEqual([]);
  });

  it("reports a wrong App Password with code 535", async () => {
    const server = fakeSmtpServer({ replies: { AUTH: "535-5.7.8 Username and Password not accepted.\r\n535 5.7.8 Learn more\r\n" } });
    const error = await sendSmtp({ ...base, connect: server.connect }).catch((e) => e);
    expect(error).toBeInstanceOf(SmtpError);
    expect(error.code).toBe(535);
  });

  it("times out instead of hanging when the server goes quiet", async () => {
    const server = fakeSmtpServer({ silent: true });
    await expect(sendSmtp({ ...base, connect: server.connect, timeoutMs: 50 })).rejects.toThrow(/timed out/);
  });
});

describe("sign-in codes through Gmail", () => {
  const gmailEnv = (server) => makeEnv({ GMAIL_USER: "owner@example.test", GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop", SMTP_CONNECT: server.connect });

  it("emails the code through Gmail (preferred over the Cloudflare binding)", async () => {
    const server = fakeSmtpServer();
    const env = gmailEnv(server);
    const r = await call(env, "/api/auth/email/start", { method: "POST", body: { email: "Ana@Example.test" } });
    expect(r.status).toBe(200);
    expect(env.EMAIL.send).not.toHaveBeenCalled();
    expect(server.log.commands).toContain("RCPT TO:<ana@example.test>");
    expect(atob(server.log.commands[1].split(" ")[2])).toBe("\0owner@example.test\0abcdefghijklmnop"); // spaces removed
    const text = decodePart(server.log.data, "text/plain");
    const code = text.match(/\b(\d{8})\b/)[1];
    const verified = await call(env, "/api/auth/email/verify", { method: "POST", body: { email: "ana@example.test", code } });
    expect(verified.status).toBe(200);
    expect(decodePart(server.log.data, "text/html")).toContain("Confirm it's you");
  });

  it("turns Gmail errors into clear messages", async () => {
    const cases = [
      [{ AUTH: "535 5.7.8 Username and Password not accepted\r\n" }, 503, /mail account setup/],
      [{ RCPT: "550 5.1.1 The email account that you tried to reach does not exist\r\n" }, 400, /doesn't seem to exist/],
      [{ MAIL: "550 5.4.5 Daily user sending limit exceeded\r\n" }, 429, /Too many emails today/],
    ];
    for (const [replies, status, message] of cases) {
      const env = gmailEnv(fakeSmtpServer({ replies }));
      const r = await call(env, "/api/auth/email/start", { method: "POST", body: { email: "ana@example.test" } });
      expect(r.status).toBe(status);
      expect((await r.json()).error).toMatch(message);
    }
  });

  it("reports email as configured when the Gmail secrets are set", async () => {
    const env = gmailEnv(fakeSmtpServer());
    delete env.EMAIL;
    expect((await (await call(env, "/api/health")).json()).emailConfigured).toBe(true);
  });
});
