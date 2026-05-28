import { describe, it, expect } from "vitest";
import {
  extractBalancedObject,
  extractGlobalAssign,
  extractInitialData,
  extractUc,
  diagnoseDetailHtml,
} from "../src/page-state.js";

describe("extractBalancedObject", () => {
  it("parses a flat JSON object starting at the brace", () => {
    const text = 'noise {"a":1,"b":"hello"} trailing';
    expect(extractBalancedObject(text, 6)).toEqual({ a: 1, b: "hello" });
  });

  it("handles nested braces inside string literals", () => {
    // The `}` inside the string shouldn't close the outer object.
    const text = '{"k":"a}b","n":{"x":1}}';
    expect(extractBalancedObject(text, 0)).toEqual({ k: "a}b", n: { x: 1 } });
  });

  it("respects escaped quotes inside strings", () => {
    const text = '{"q":"he said \\"hi\\""}';
    expect(extractBalancedObject(text, 0)).toEqual({ q: 'he said "hi"' });
  });

  it("returns null when the cursor is not at a brace", () => {
    expect(extractBalancedObject("abc {x:1}", 0)).toBeNull();
  });
});

describe("extractGlobalAssign", () => {
  it("extracts `global.<name> = {…}`", () => {
    const html =
      '<html>...<script>global.uc = {"foo":42,"nested":{"k":"v"}};</script>';
    expect(extractGlobalAssign(html, "uc")).toEqual({
      foo: 42,
      nested: { k: "v" },
    });
  });

  it("extracts `window.<name> = {…}` as well", () => {
    const html =
      '<script>window.__INITIAL_DATA__ = {"props":{"x":1}};</script>';
    expect(extractGlobalAssign(html, "__INITIAL_DATA__")).toEqual({
      props: { x: 1 },
    });
  });

  it("returns null when the assignment is missing", () => {
    expect(extractGlobalAssign("<html>nothing</html>", "uc")).toBeNull();
  });

  it("returns null when the object is malformed", () => {
    expect(
      extractGlobalAssign("<script>global.uc = {bad json};</script>", "uc"),
    ).toBeNull();
  });

  it("extracts `self.<name> = {…}` (homedetails build drift)", () => {
    // Compass started emitting `self.__INITIAL_DATA__` in some sessions;
    // the old global|window-only anchor missed it. Regression guard.
    const html =
      '<script>self.__INITIAL_DATA__ = {"props":{"listingRelation":{"listing":{"listingIdSHA":"xyz"}}}};</script>';
    expect(extractGlobalAssign(html, "__INITIAL_DATA__")).toEqual({
      props: { listingRelation: { listing: { listingIdSHA: "xyz" } } },
    });
  });

  it("tolerates whitespace/newlines between `=` and the brace", () => {
    const html =
      'document);\n          window.__INITIAL_DATA__ =\n   {"props":{"x":1}};';
    expect(extractGlobalAssign(html, "__INITIAL_DATA__")).toEqual({
      props: { x: 1 },
    });
  });

  it('does not false-match a nested quoted "uc" key', () => {
    // Only assignment prefixes count — a bare quoted key inside another
    // object must not be picked up (would regress the search path).
    const html = '<script>window.other = {"uc":{"trap":true}};</script>';
    expect(extractGlobalAssign(html, "uc")).toBeNull();
  });
});

describe("diagnoseDetailHtml", () => {
  it("reports token presence + context when __INITIAL_DATA__ exists", () => {
    const html =
      '<title>860 Union Street</title><script>window.__INITIAL_DATA__ = {"props":{"listingRelation":{}}};</script>';
    const diag = diagnoseDetailHtml(html);
    expect(diag).toContain("token=true");
    expect(diag).toContain("listingRelation=true");
    expect(diag).toContain("nearToken=");
    expect(diag).toContain("860 Union Street");
  });

  it("flags challenge-like pages and missing token", () => {
    const html =
      "<title>Access Denied</title><body>Please verify you are a human</body>";
    const diag = diagnoseDetailHtml(html);
    expect(diag).toContain("token=false");
    expect(diag).toContain("challengeLike=true");
  });
});

describe("extractUc / extractInitialData wrappers", () => {
  it("extractUc finds the uc global", () => {
    const html = '<script>global.uc = {"geoId":"nyc"};</script>';
    expect(extractUc(html)).toEqual({ geoId: "nyc" });
  });

  it("extractInitialData finds the __INITIAL_DATA__ global", () => {
    const html =
      '<script>window.__INITIAL_DATA__ = {"props":{"listingRelation":{"listing":{"listingIdSHA":"abc"}}}};</script>';
    expect(extractInitialData(html)).toEqual({
      props: { listingRelation: { listing: { listingIdSHA: "abc" } } },
    });
  });
});
