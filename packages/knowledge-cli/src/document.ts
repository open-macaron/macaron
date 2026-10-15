import type { Heading, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { toString } from "mdast-util-to-string";
import { frontmatter } from "micromark-extension-frontmatter";
import { parse as parseYaml } from "yaml";

/** A Markdown file with YAML front matter: the shape of every rule and lesson. */
export interface MarkdownDocument {
  /** Parsed YAML, still unvalidated. */
  readonly frontMatter: unknown;
  /** Everything after the front matter. */
  readonly body: string;
  /** Top-level headings, in order. */
  readonly headings: readonly { readonly depth: number; readonly text: string }[];
}

export type ParseResult = { readonly ok: true; readonly document: MarkdownDocument } | { readonly ok: false; readonly error: string };

/** YAML without aliases: a knowledge file never needs them, and they enable expansion bombs. */
export function parseYamlStrict(source: string): unknown {
  return parseYaml(source, { maxAliasCount: 0, uniqueKeys: true });
}

export function parseDocument(source: string): ParseResult {
  const tree: Root = fromMarkdown(source, { extensions: [frontmatter(["yaml"])], mdastExtensions: [frontmatterFromMarkdown(["yaml"])] });
  const [first] = tree.children;
  if (first?.type !== "yaml") return { ok: false, error: "missing YAML front matter (a first block between `---` lines)" };
  const end = first.position?.end.offset;
  if (end === undefined) return { ok: false, error: "front matter without a position" };

  let frontMatter: unknown;
  try {
    frontMatter = parseYamlStrict(first.value);
  } catch (error: unknown) {
    return { ok: false, error: `front matter is not valid YAML: ${error instanceof Error ? error.message : String(error)}` };
  }
  const headings = tree.children
    .filter((node): node is Heading => node.type === "heading")
    .map((heading) => ({ depth: heading.depth, text: toString(heading).trim() }));
  return { ok: true, document: { frontMatter, body: source.slice(end).trim(), headings } };
}
