import { describe, expect, it } from "vitest";
import { escapeHtml, loginCodeEmail, requestLocation } from "../../shared/email.js";
import { call, makeEnv } from "./helpers.js";

describe("sign-in email", () => {
  const mail = loginCodeEmail({ code: "74346404", appUrl: "https://datachat.harmongt.uk/", location: "Dubai, AE" });

  it("puts the code first in the subject so it shows in notifications", () => {
    expect(mail.subject).toBe("74346404 is your DataChat sign-in code");
  });

  it("has a plain-text version with the code, expiry and safety advice", () => {
    expect(mail.text).toContain("74346404");
    expect(mail.text).toContain("expires in 10 minutes");
    expect(mail.text).toContain("Requested from Dubai, AE.");
    expect(mail.text).toContain("Never share this code");
  });

  it("uses the app's colours, an absolute logo URL and the site link", () => {
    expect(mail.html).toContain("#07101f");
    expect(mail.html).toContain("#d7a62b");
    expect(mail.html).toContain('src="https://datachat.harmongt.uk/assets/email-logo.png"');
    expect(mail.html).toContain('href="https://datachat.harmongt.uk"');
    expect(mail.html).toContain(">74346404</td>");
  });

  it("escapes anything that ends up in the HTML", () => {
    const evil = loginCodeEmail({ code: "1", appUrl: "https://x.test", location: '<img src=x onerror="alert(1)">' });
    expect(evil.html).not.toContain("<img src=x");
    expect(evil.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(escapeHtml(`<a href='x'>&</a>`)).toBe("&lt;a href=&#39;x&#39;&gt;&amp;&lt;/a&gt;");
  });

  it("leaves out the location line when it is unknown", () => {
    expect(loginCodeEmail({ code: "1", appUrl: "https://x.test" }).text).not.toContain("Requested from");
  });
});

describe("request location", () => {
  it("formats Cloudflare's city and country", () => {
    expect(requestLocation({ city: "Addis Ababa", country: "ET" })).toBe("Addis Ababa, ET");
    expect(requestLocation({ country: "AE" })).toBe("AE");
    expect(requestLocation(undefined)).toBe("");
  });
});

describe("sending", () => {
  it("sends the branded email through the Email Service binding", async () => {
    const env = makeEnv();
    await call(env, "/api/auth/email/start", { method: "POST", body: { email: "ana@example.test" } });
    const sent = env.sent.at(-1);
    expect(sent).toMatchObject({ from: "DataChat <no-reply@datachat.test>", to: "ana@example.test" });
    expect(sent.html).toContain("Confirm it's you");
    expect(sent.html).toContain("https://datachat.test/assets/email-logo.png");
  });

  it("explains clearly when the address cannot receive codes yet (free Email Routing)", async () => {
    const env = makeEnv();
    env.EMAIL.send.mockRejectedValueOnce(Object.assign(new Error("not allowed"), { code: "E_RECIPIENT_NOT_ALLOWED" }));
    const r = await call(env, "/api/auth/email/start", { method: "POST", body: { email: "stranger@example.test" } });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/can't send codes to this address yet/);
  });
});
