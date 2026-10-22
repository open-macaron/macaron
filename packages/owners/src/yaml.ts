import { parse as parseYaml } from "yaml";

/** YAML without aliases: no owned file needs them, and they enable expansion bombs. */
export function parseYamlStrict(source: string): unknown {
  return parseYaml(source, { maxAliasCount: 0, uniqueKeys: true });
}
