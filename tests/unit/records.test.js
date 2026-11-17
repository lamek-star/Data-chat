import { describe, expect, it } from "vitest";
import {
  buildClaimCode,
  claimCodeMatches,
  generateSecurityKey,
  generateTransactionId,
  importRecordsFromCsv,
  isValidSecurityKey,
  parseCsv,
  recordsToCsv,
} from "../../src/lib/records.js";

const record = (over = {}) => ({
  id: "TXN-1048",
  receiver: "Sara Bekele",
  key: "042917",
  amount: 250,
  ...over,
});

describe("security keys and IDs", () => {
  it("generates six-digit keys, including leading zeros, from crypto", () => {
    const keys = Array.from({ length: 2000 }, generateSecurityKey);
    expect(keys.every(isValidSecurityKey)).toBe(true);
    expect(new Set(keys).size).toBeGreaterThan(1950);
    expect(keys.some((k) => k.startsWith("0"))).toBe(true);
  });

  it("rejects malformed keys", () => {
    for (const bad of ["", "12345", "1234567", "12a456", null, undefined, 123456.5])
      expect(isValidSecurityKey(bad)).toBe(false);
    expect(isValidSecurityKey("000000")).toBe(true);
  });

  it("generates unambiguous, practically unique transaction IDs", () => {
    const ids = Array.from({ length: 5000 }, generateTransactionId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids.slice(0, 100)) expect(id).toMatch(/^TXN-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });
});

describe("claim codes", () => {
  it("keeps the existing format for Latin names", () => {
    expect(buildClaimCode(record())).toBe("DC1-TXN1048-SARABEKELE-042917");
  });

  it("accepts the right code regardless of case and outer spaces", () => {
    expect(claimCodeMatches("  dc1-txn1048-sarabekele-042917 ", record())).toBe(true);
  });

  it("rejects a wrong key, a different receiver, a different transfer, or the key alone", () => {
    expect(claimCodeMatches("DC1-TXN1048-SARABEKELE-042918", record())).toBe(false);
    expect(claimCodeMatches("DC1-TXN1048-ABELTESFAY-042917", record())).toBe(false);
    expect(claimCodeMatches("DC1-TXN1049-SARABEKELE-042917", record())).toBe(false);
    expect(claimCodeMatches("042917", record())).toBe(false);
    expect(claimCodeMatches("", record())).toBe(false);
  });

  it("never matches a record without a valid key", () => {
    expect(claimCodeMatches("DC1-TXN1048-SARABEKELE-", record({ key: "" }))).toBe(false);
    expect(claimCodeMatches("DC1-TXN1048-SARABEKELE-undefined", record({ key: undefined }))).toBe(false);
  });

  it("binds non-Latin receiver names instead of dropping them", () => {
    const amharic = record({ receiver: "ሳራ በቀለ" });
    const other = record({ receiver: "አበበ ከበደ" });
    expect(buildClaimCode(amharic)).toMatch(/^DC1-TXN1048-U[0-9A-Z]+-042917$/);
    expect(buildClaimCode(amharic)).not.toBe(buildClaimCode(other));
    expect(claimCodeMatches(buildClaimCode(other), amharic)).toBe(false);
  });

  it("still accepts codes issued before non-Latin names were bound", () => {
    expect(claimCodeMatches("DC1-TXN1048--042917", record({ receiver: "ሳራ በቀለ" }))).toBe(true);
  });
});

describe("CSV export", () => {
  it("neutralises spreadsheet formulas but keeps negative numbers", () => {
    const csv = recordsToCsv([record({ remark: '=HYPERLINK("http://evil","x")', sender: "@SUM(A1)", amount: -5, tag: "+cmd" })]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csv).toContain(`"'@SUM(A1)"`);
    expect(csv).toContain(`"'+cmd"`);
    expect(csv).toContain(`"-5"`);
  });

  it("starts with a BOM so Excel reads UTF-8 names", () => {
    expect(recordsToCsv([]).charCodeAt(0)).toBe(0xfeff);
  });
});

describe("CSV parsing", () => {
  it("handles quotes, commas and newlines inside fields, and CRLF", () => {
    const rows = parseCsv('a,b,c\r\n"1,5","say ""hi""","line one\nline two"\r\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1,5", 'say "hi"', "line one\nline two"],
    ]);
  });

  it("ignores blank lines", () => {
    expect(parseCsv("a\n\n1\n\n")).toEqual([["a"], ["1"]]);
  });
});

describe("CSV import", () => {
  const opts = { ownerId: "user-1", existingIds: ["TXN-1048"], today: "2026-11-17" };

  it("round-trips an export, including Amharic text and multi-line remarks", () => {
    const original = record({ id: "TXN-AAAA-BBBB", sender: "አበበ", remark: "first\nsecond, third", date: "2026-01-02", currency: "ETB", rate: 57.5, status: "Pending", tag: "x" });
    const { records } = importRecordsFromCsv(recordsToCsv([original]), opts);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: "TXN-AAAA-BBBB", sender: "አበበ", remark: "first\nsecond, third", amount: 250, rate: 57.5, currency: "ETB", key: "042917", owner: "user-1", date: "2026-01-02" });
  });

  it("restores formula-escaped text exactly", () => {
    const { records } = importRecordsFromCsv(recordsToCsv([record({ id: "TXN-X", remark: "=1+1" })]), opts);
    expect(records[0].remark).toBe("=1+1");
  });

  it("gives every row a valid key and replaces duplicate or missing IDs", () => {
    const csv = "ID,Receiver,Amount,Security Key\nTXN-1048,A,1,\n,B,2,12\nTXN-NEW,C,3,999999\nTXN-NEW,D,4,abc";
    const { records } = importRecordsFromCsv(csv, opts);
    expect(records.map((r) => isValidSecurityKey(r.key))).toEqual([true, true, true, true]);
    expect(records[2].key).toBe("999999");
    const ids = records.map((r) => r.id);
    expect(new Set([...ids, "TXN-1048"]).size).toBe(5);
    expect(ids[0]).not.toBe("TXN-1048");
    expect(ids[2]).toBe("TXN-NEW");
  });

  it("assigns the importing owner, never one from the file", () => {
    const { records } = importRecordsFromCsv("Owner,Receiver,Amount\nsomeone-else,A,1", opts);
    expect(records[0].owner).toBe("user-1");
  });

  it("cleans bad numbers and dates", () => {
    const { records } = importRecordsFromCsv("Receiver,Amount,Rate,Date\nA,\"1,250.50\",abc,17/11/2026", opts);
    expect(records[0]).toMatchObject({ amount: 1250.5, rate: 1, date: "2026-11-17" });
  });

  it("skips empty rows and refuses unrelated files", () => {
    expect(importRecordsFromCsv("Receiver,Amount,Remark\n,,note only\nA,1,", opts)).toMatchObject({ skipped: 1 });
    expect(() => importRecordsFromCsv("name,email\nx,y", opts)).toThrow(/Amount or Receiver/);
    expect(importRecordsFromCsv("", opts).records).toEqual([]);
  });
});
