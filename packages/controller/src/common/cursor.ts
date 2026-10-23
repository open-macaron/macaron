/** `<ISO date>|<uuid>`, base64url: where the next page of a newest-first list starts. */
export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
}

export function decodeCursor(cursor: string): { readonly at: Date; readonly id: string } | undefined {
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const at = new Date(iso ?? "");
  return id === undefined || Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/.test(id) ? undefined : { at, id };
}
