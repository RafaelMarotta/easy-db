import * as vscode from "vscode";
import { Variable } from "../adapters/types";

export interface ResolvedVariables {
  values: Map<string, string>;
  maskedPreview: Map<string, string>;
}

export async function gatherVariables(context: vscode.ExtensionContext): Promise<Variable[]> {
  // Prefer global variables for reuse across connections; include workspace for backwards-compat
  const gs = context.globalState.get<Variable[]>("variables", []) ?? [];
  const ws = context.workspaceState.get<Variable[]>("variables", []) ?? [];
  const merged = new Map<string, Variable>();
  for (const v of gs) merged.set(v.id, v);
  for (const v of ws) if (!merged.has(v.id)) merged.set(v.id, v);
  return Array.from(merged.values());
}

export async function resolveVariables(context: vscode.ExtensionContext): Promise<ResolvedVariables> {
  const vars = await gatherVariables(context);
  const values = new Map<string, string>();
  const maskedPreview = new Map<string, string>();
  for (const v of vars) {
    if (v.isSecret) {
      const s = await context.secrets.get(`var:${v.id}`);
      if (s != null) {
        values.set(v.id, s);
        maskedPreview.set(v.id, mask(s));
      }
    } else if (v.value != null) {
      values.set(v.id, v.value);
      maskedPreview.set(v.id, v.value);
    }
  }
  // Resolve nested references
  const resolving = new Set<string>();
  const cache = new Map<string, string>();
  const getVal = (key: string): string | undefined => {
    if (cache.has(key)) return cache.get(key);
    if (resolving.has(key)) throw new Error(`Circular variable reference detected at ${key}`);
    resolving.add(key);
    const raw = values.get(key);
    if (raw == null) { resolving.delete(key); return undefined; }
    const resolved = interpolateString(raw, (name) => getVal(name));
    cache.set(key, resolved);
    resolving.delete(key);
    return resolved;
  };
  for (const key of Array.from(values.keys())) {
    const v = getVal(key);
    if (v != null) values.set(key, v);
  }
  return { values, maskedPreview };
}

export function interpolateString(input: string, getter: (name: string) => string | undefined): string {
  return input.replace(/\$\{([A-Za-z0-9_.-]+)\}/g, (_, name: string) => {
    const v = getter(name);
    if (v == null) throw new Error(`Missing variable: ${name}`);
    return v;
  });
}

export function mask(secret: string): string {
  if (!secret) return "";
  if (secret.length <= 4) return "••••";
  return secret.slice(0, 2) + "••••" + secret.slice(-2);
}

export async function saveVariable(context: vscode.ExtensionContext, v: Variable): Promise<void> {
  // Always save into global to keep variables reusable across connections
  const list = context.globalState.get<Variable[]>("variables", []) ?? [];
  const next = list.filter(x => x.id !== v.id).concat([{ id: v.id, scope: "user", isSecret: v.isSecret, value: v.isSecret ? undefined : (v.value ?? "") }]);
  await context.globalState.update("variables", next);
  if (v.isSecret && v.value) await context.secrets.store(`var:${v.id}`, v.value);
}

export async function deleteVariable(context: vscode.ExtensionContext, id: string): Promise<void> {
  const gs = context.globalState.get<Variable[]>("variables", []) ?? [];
  await context.globalState.update("variables", gs.filter(v => v.id !== id));
  await context.secrets.delete(`var:${id}`);
}

export async function saveVariablesBulk(context: vscode.ExtensionContext, items: { id: string; value: string }[]): Promise<void> {
  const clean = items.filter(i => i.id && i.id.trim().length > 0).map(i => ({ id: i.id.trim(), scope: "user" as const, value: i.value ?? "" }));
  await context.globalState.update("variables", clean);
}
