/** JSON has no bigint. Every amount crosses the wire as a decimal string (spec §5). */
export const jsonSafe = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)));
