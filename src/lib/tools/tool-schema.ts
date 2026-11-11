import { z } from "zod";
const recordSchema = z.record(z.string(), z.unknown());
const schemaKeys = ["type", "enum", "description", "required"] as const;
/** Keep the subset understood by fm; inline local refs, bound cycles. Validate originals separately. */
export const sanitizeSchema = (input: unknown): Record<string, unknown> => {
  const root = recordSchema.parse(input);
  const visit = (value: unknown, refs: string[]): Record<string, unknown> => {
    const node = recordSchema.parse(value);
    if (typeof node.$ref === "string") {
      if (!node.$ref.startsWith("#/") || refs.includes(node.$ref)) return { type: "string" };
      let target: unknown = root;
      for (const part of node.$ref.slice(2).split("/")) target = recordSchema.parse(target)[part.replaceAll("~1", "/").replaceAll("~0", "~")];
      return visit(target, [...refs, node.$ref]);
    }
    const out: Record<string, unknown> = {};
    for (const key of schemaKeys) if (node[key] !== undefined) out[key] = node[key];
    for (const key of ["anyOf", "oneOf"] as const) if (Array.isArray(node[key])) out.anyOf = node[key].map((item) => visit(item, refs));
    if (node.type === "object" || node.properties) {
      out.type = "object";
      out.properties = Object.fromEntries(Object.entries(recordSchema.parse(node.properties ?? {})).map(([key, schema]) => [key, visit(schema, refs)]));
      // fm rejects bare objects and boolean additionalProperties on this build.
    }
    if (node.items) out.items = visit(node.items, refs);
    if (Object.keys(out).length === 0) out.type = "string";
    return out;
  };
  return visit(root, []);
};
export const fallbackSchema = { type: "object", properties: { json: { type: "string" } }, required: ["json"] } as const;
