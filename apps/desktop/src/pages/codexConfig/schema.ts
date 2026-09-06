import generatedSchema from "./schema.generated.json";
import { fieldLabel } from "./labels";

export type ConfigValue = string | number | boolean | ConfigValue[] | { [key: string]: ConfigValue };
export type ConfigValues = Record<string, ConfigValue>;
export type ConfigCommit = (path: string[], value: ConfigValue | null) => Promise<boolean>;

export interface ConfigSchema {
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, ConfigSchema>;
  additionalProperties?: boolean | ConfigSchema;
  items?: ConfigSchema;
  enum?: ConfigValue[];
  const?: ConfigValue;
  default?: unknown;
  anyOf?: ConfigSchema[];
  oneOf?: ConfigSchema[];
  allOf?: ConfigSchema[];
  required?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  description?: string;
}

// Complete upstream schema, copied without modification on 2026-09-06 from
// codex-rs/core/config.schema.json, openai/codex commit 6af345407d9c2a568da9d01b6c4b81a9e61495c0.
// The generated JSON asset is intentionally not subject to source-file line limits.
export const configSchema = generatedSchema as unknown as ConfigSchema;
const definitions = generatedSchema.definitions as unknown as Record<string, ConfigSchema>;
const MAX_SCHEMA_DEPTH = 18;

export function resolveSchema(input: ConfigSchema = {}, depth = 0): ConfigSchema {
  if (depth >= MAX_SCHEMA_DEPTH) return input;
  const { $ref, allOf, ...own } = input;
  const referenced = $ref ? definitions[$ref.split("/").pop() ?? ""] : undefined;
  const base = referenced ? resolveSchema(referenced, depth + 1) : {};
  return (allOf ?? []).reduce(
    (result, part) => ({ ...result, ...resolveSchema(part, depth + 1), ...own }),
    { ...base, ...own },
  );
}

export function schemaVariants(input: ConfigSchema): ConfigSchema[] {
  const schema = resolveSchema(input);
  const variants = schema.oneOf ?? schema.anyOf;
  if (!variants) return [schema];
  const { oneOf: _oneOf, anyOf: _anyOf, ...base } = schema;
  const resolved = variants.map((variant) => ({ ...base, ...resolveSchema(variant) }));
  if (resolved.every((variant) => variant.type === "string" && variant.enum)) {
    return [{ ...base, type: "string", enum: resolved.flatMap((variant) => variant.enum ?? []) }];
  }
  return resolved.filter((variant) => variant.type !== "null");
}

export function valueType(value: ConfigValue | undefined): string {
  if (Array.isArray(value)) return "array";
  if (value !== undefined && typeof value === "object") return "object";
  return value === undefined ? "string" : typeof value;
}

export function schemaType(schema: ConfigSchema, value?: ConfigValue): string {
  const type = schema.type;
  if (Array.isArray(type)) return type.find((item) => item === valueType(value)) ?? type[0];
  if (type) return type;
  if (schema.properties || schema.additionalProperties) return "object";
  return valueType(value);
}

export function variantIndex(variants: ConfigSchema[], value?: ConfigValue): number {
  const scores = variants.map((schema) => variantScore(schema, value));
  return Math.max(0, scores.indexOf(Math.max(...scores)));
}

function variantScore(schema: ConfigSchema, value?: ConfigValue): number {
  if (schema.enum) return schema.enum.includes(value as ConfigValue) ? 10 : -1;
  if (schema.const !== undefined) return schema.const === value ? 10 : -1;
  const type = schemaType(schema, value);
  if (type === "integer" && typeof value === "number") return 1;
  if (type !== valueType(value)) return -1;
  if (type !== "object") return 1;
  const values = objectValue(value);
  let score = 1;
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    if (values[key] === undefined) continue;
    const resolved = resolveSchema(property);
    if (resolved.enum && !resolved.enum.includes(values[key])) return -1;
    score += resolved.enum ? 10 : 1;
  }
  return score;
}

export function initialValue(input: ConfigSchema): ConfigValue {
  const schema = schemaVariants(input)[0] ?? {};
  if (["string", "number", "boolean"].includes(typeof schema.default)) return schema.default as ConfigValue;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum?.length) return schema.enum[0];
  const type = schemaType(schema);
  if (type === "object") {
    return Object.fromEntries((schema.required ?? []).map((key) => [
      key, initialValue(schema.properties?.[key] ?? {}),
    ]));
  }
  if (type === "array") return [];
  if (type === "boolean") return false;
  if (type === "number" || type === "integer") return schema.minimum ?? 0;
  return "";
}

export function childSchema(schema: ConfigSchema, key: string, value?: ConfigValue): ConfigSchema {
  const known = Object.prototype.hasOwnProperty.call(schema.properties ?? {}, key)
    ? schema.properties?.[key] : undefined;
  if (known) return known;
  if (typeof schema.additionalProperties === "object") return schema.additionalProperties;
  return { type: valueType(value) };
}

export function objectValue(value: ConfigValue | undefined): ConfigValues {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function matchesSearch(options: {
  key: string;
  schema: ConfigSchema;
  value?: ConfigValue;
  query: string;
  depth?: number;
}): boolean {
  const { key, schema, value, query, depth = 0 } = options;
  if (!query || `${fieldLabel(key)} ${key}`.toLowerCase().includes(query)) return true;
  if (depth >= MAX_SCHEMA_DEPTH) return false;
  return schemaVariants(schema).some((variant) => {
    if (variant.items && matchesSearch({ key: "", schema: variant.items, query, depth: depth + 1 })) return true;
    if (Array.isArray(value) && value.some((item) => matchesSearch({
      key: "", schema: variant.items ?? {}, value: item, query, depth: depth + 1,
    }))) return true;
    const values = objectValue(value);
    const keys = new Set([...Object.keys(variant.properties ?? {}), ...Object.keys(values)]);
    return [...keys].some((name) => matchesSearch({
      key: name, schema: childSchema(variant, name, values[name]), value: values[name], query, depth: depth + 1,
    }));
  });
}

export function replaceNestedValue(options: {
  value: ConfigValue;
  path: string[];
  replacement: ConfigValue | null;
}): ConfigValue {
  const { value, path, replacement } = options;
  if (!path.length) return replacement ?? "";
  const [head, ...tail] = path;
  if (Array.isArray(value)) {
    const copy = [...value];
    if (!tail.length && replacement === null) copy.splice(Number(head), 1);
    else copy[Number(head)] = replaceNestedValue({ value: copy[Number(head)] ?? {}, path: tail, replacement });
    return copy;
  }
  const copy = { ...objectValue(value) };
  if (!tail.length && replacement === null) delete copy[head];
  else Object.defineProperty(copy, head, {
    value: replaceNestedValue({ value: Object.prototype.hasOwnProperty.call(copy, head) ? copy[head] : {},
      path: tail, replacement }), enumerable: true, writable: true, configurable: true,
  });
  return copy;
}
