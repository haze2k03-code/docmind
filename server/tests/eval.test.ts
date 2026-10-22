import { describe, expect, it } from "vitest";
import {
  citesExpectedPage,
  containsAll,
  containsDocument,
  findRank,
  normalizeText,
  parseArgs,
} from "../src/scripts/evalLib.js";

const chunks = [
  { title: "Northwind Employee Handbook", page: 3 },
  { title: "Northwind Employee Handbook", page: 2 },
  { title: "Northwind Engineering Handbook", page: 1 },
];

describe("findRank", () => {
  it("returns the 1-based position of the expected page", () => {
    expect(findRank(chunks, "Northwind Employee Handbook", 2)).toBe(2);
  });
  it("ignores title case", () => {
    expect(findRank(chunks, "northwind engineering handbook", 1)).toBe(3);
  });
  it("returns 0 when the page isn't retrieved", () => {
    expect(findRank(chunks, "Northwind Employee Handbook", 4)).toBe(0);
  });
});

describe("containsDocument", () => {
  it("detects a chunk from a restricted document", () => {
    expect(containsDocument(chunks, "Northwind Engineering Handbook")).toBe(true);
    expect(containsDocument(chunks, "Northwind Compensation Guidelines")).toBe(false);
  });
});

describe("containsAll", () => {
  it("matches thousands separators either way", () => {
    expect(normalizeText("INR 1,500 per month")).toBe("inr 1500 per month");
    expect(containsAll("You get INR 1,500 per month [1].", ["1500"])).toBe(true);
  });
  it("matches numbers as whole numbers only", () => {
    expect(containsAll("You get 18 days [1].", ["8"])).toBe(false);
    expect(containsAll("Up to 8 percent [1].", ["8"])).toBe(true);
    expect(containsAll("Up to 8.5 percent.", ["8"])).toBe(false);
    expect(containsAll("It is 8.", ["8"])).toBe(true);
  });
  it("needs every expected string, case-insensitively", () => {
    expect(containsAll("Deploys happen on tuesdays and THURSDAYS.", ["Tuesday", "Thursday"])).toBe(true);
    expect(containsAll("Deploys happen on Tuesdays.", ["Tuesday", "Thursday"])).toBe(false);
  });
});

describe("citesExpectedPage", () => {
  it("is true when a cited source number points at the expected page", () => {
    expect(citesExpectedPage("18 days of leave [2].", chunks, "Northwind Employee Handbook", 2)).toBe(true);
  });
  it("is false when it only cites other pages or invalid numbers", () => {
    expect(citesExpectedPage("18 days of leave [1][9].", chunks, "Northwind Employee Handbook", 2)).toBe(false);
  });
});

describe("parseArgs", () => {
  it("reads flags in both --k 8 and --k=8 forms", () => {
    expect(parseArgs(["--k", "8", "--min-sim=0.5", "--label", "after"])).toMatchObject({
      answers: false,
      k: 8,
      minSim: 0.5,
      label: "after",
      delayMs: 0,
    });
  });
  it("spaces out LLM calls by default when grading answers", () => {
    expect(parseArgs(["--answers"]).delayMs).toBe(4000);
  });
  it("rejects a non-numeric number flag", () => {
    expect(() => parseArgs(["--k", "lots"])).toThrow();
  });
});
