import { describe, it, expect } from "vitest";
import { osiLayersFor, formatOsiLayers } from "../../src/tracer/osiLayers.js";

describe("osiLayersFor", () => {
  it("maps single-layer protocols", () => {
    expect(osiLayersFor("eth", false)).toEqual([2, 2]);
    expect(osiLayersFor("IP", false)).toEqual([3, 3]);
    expect(osiLayersFor("tcp", false)).toEqual([4, 4]);
    expect(osiLayersFor("http", false)).toEqual([7, 7]);
  });

  it("maps ARP to 2/3 and TLS to 4/5", () => {
    expect(osiLayersFor("arp", false)).toEqual([2, 3]);
    expect(osiLayersFor("tls", false)).toEqual([4, 5]);
  });

  it("maps application protocols inside TLS to 5–7", () => {
    expect(osiLayersFor("http", true)).toEqual([5, 7]);
    expect(osiLayersFor("tcp", true)).toEqual([4, 4]);
  });

  it("leaves the capture-metadata frame node and unknown protocols unmapped", () => {
    expect(osiLayersFor("frame", false)).toBeNull();
    expect(osiLayersFor("whatever", false)).toBeNull();
  });
});

describe("formatOsiLayers", () => {
  it("formats single layers, adjacent pairs and ranges", () => {
    expect(formatOsiLayers([3, 3])).toBe("3");
    expect(formatOsiLayers([2, 3])).toBe("2/3");
    expect(formatOsiLayers([5, 7])).toBe("5–7");
  });
});
