import { describe, expect, it } from "vitest";
import { isPublicAddress, publicHostRefusal } from "../../src/endpoints/public-address.ts";

describe("isPublicAddress", () => {
  it("accepts global unicast addresses", () => {
    for (const address of ["1.1.1.1", "140.82.112.3", "2606:4700:4700::1111"]) expect(isPublicAddress(address), address).toBe(true);
  });

  it("refuses every private, local and reserved range, IPv4-mapped included", () => {
    for (const address of [
      "10.0.0.5", "172.16.3.4", "192.168.1.1", "127.0.0.1", "0.0.0.0", "169.254.169.254", "100.64.0.1", "224.0.0.1", "255.255.255.255",
      "::1", "::", "fe80::1", "fd00::1", "ff02::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "not-an-ip",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });
});

describe("publicHostRefusal", () => {
  const dns = (answers: Record<string, readonly string[]>) => (host: string): Promise<readonly string[]> => {
    const found = answers[host];
    return found === undefined ? Promise.reject(new Error("ENOTFOUND")) : Promise.resolve(found);
  };

  it("accepts a host whose every address is public", async () => {
    expect(await publicHostRefusal("https://api.example.test", dns({ "api.example.test": ["1.1.1.1", "2606:4700:4700::1111"] }))).toBeUndefined();
  });

  it("refuses a host with one private address among public ones", async () => {
    expect(await publicHostRefusal("https://mixed.example.test", dns({ "mixed.example.test": ["1.1.1.1", "10.0.0.7"] }))).toMatch(/10\.0\.0\.7/);
  });

  it("refuses private and metadata literals without asking DNS", async () => {
    expect(await publicHostRefusal("https://169.254.169.254", dns({}))).toMatch(/private or reserved/);
    expect(await publicHostRefusal("https://[::1]:8443", dns({}))).toMatch(/private or reserved/);
  });

  it("refuses a host that doesn't resolve", async () => {
    expect(await publicHostRefusal("https://nowhere.example.test", dns({}))).toBe("nowhere.example.test doesn't resolve");
  });
});
