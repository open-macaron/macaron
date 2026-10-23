import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

/** Resolves a host name to every address it has (A and AAAA). */
export type Resolve = (host: string) => Promise<readonly string[]>;

export const resolveAll: Resolve = async (host) => (await lookup(host, { all: true, verbatim: true })).map(({ address }) => address);

/**
 * Is `address` on the public internet? Only global unicast: no private, loopback, link-local,
 * carrier-grade NAT, unique-local, multicast or reserved range, IPv4-mapped IPv6 included.
 */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.process(address);
  return parsed.range() === "unicast";
}

/**
 * Why `baseUrl`'s host can't receive users' keys, or undefined when every address it resolves to
 * is public. A host resolving to one private address is refused: DNS answers can rotate.
 */
export async function publicHostRefusal(baseUrl: string, resolve: Resolve = resolveAll): Promise<string | undefined> {
  const url = URL.parse(baseUrl);
  if (url === null) return "not a URL";
  // URL keeps an IPv6 literal's brackets.
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  let addresses: readonly string[];
  try {
    addresses = ipaddr.isValid(host) ? [host] : await resolve(host);
  } catch {
    return `${host} doesn't resolve`;
  }
  if (addresses.length === 0) return `${host} doesn't resolve`;
  const inner = addresses.filter((address) => !isPublicAddress(address));
  return inner.length === 0 ? undefined : `${host} resolves to a private or reserved address (${inner.join(", ")})`;
}
