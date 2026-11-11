import { MCP_POLICY } from "./mcp.config.ts";

const matches = (pattern: string, name: string): boolean =>
  new RegExp("^" + pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(name);

export const mcpToolAllowed = (remote: string, namespaced: string,
  allow = process.env[MCP_POLICY.allowEnv], deny = process.env[MCP_POLICY.denyEnv]): boolean => {
  const patterns = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
  // Explicit allow replaces defaults, including the default family exclusions.
  const allowed = allow === undefined ? MCP_POLICY.defaultAllow : patterns(allow);
  const denied = deny === undefined ? (allow === undefined ? MCP_POLICY.defaultDeny : []) : patterns(deny);
  const applies = (pattern: string) => matches(pattern, remote) || matches(pattern, namespaced);
  const blocked = deny === undefined && allow === undefined
    ? MCP_POLICY.defaultDeny.some((pattern) => matches(pattern, remote))
    : denied.some(applies);
  return allowed.some(applies) && !blocked;
};
