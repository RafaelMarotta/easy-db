"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gatherVariables = gatherVariables;
exports.resolveVariables = resolveVariables;
exports.interpolateString = interpolateString;
exports.mask = mask;
exports.saveVariable = saveVariable;
exports.deleteVariable = deleteVariable;
exports.saveVariablesBulk = saveVariablesBulk;
async function gatherVariables(context) {
    // Prefer global variables for reuse across connections; include workspace for backwards-compat
    const gs = context.globalState.get("variables", []) ?? [];
    const ws = context.workspaceState.get("variables", []) ?? [];
    const merged = new Map();
    for (const v of gs)
        merged.set(v.id, v);
    for (const v of ws)
        if (!merged.has(v.id))
            merged.set(v.id, v);
    return Array.from(merged.values());
}
async function resolveVariables(context) {
    const vars = await gatherVariables(context);
    const values = new Map();
    const maskedPreview = new Map();
    for (const v of vars) {
        if (v.isSecret) {
            const s = await context.secrets.get(`var:${v.id}`);
            if (s != null) {
                values.set(v.id, s);
                maskedPreview.set(v.id, mask(s));
            }
        }
        else if (v.value != null) {
            values.set(v.id, v.value);
            maskedPreview.set(v.id, v.value);
        }
    }
    // Resolve nested references
    const resolving = new Set();
    const cache = new Map();
    const getVal = (key) => {
        if (cache.has(key))
            return cache.get(key);
        if (resolving.has(key))
            throw new Error(`Circular variable reference detected at ${key}`);
        resolving.add(key);
        const raw = values.get(key);
        if (raw == null) {
            resolving.delete(key);
            return undefined;
        }
        const resolved = interpolateString(raw, (name) => getVal(name));
        cache.set(key, resolved);
        resolving.delete(key);
        return resolved;
    };
    for (const key of Array.from(values.keys())) {
        const v = getVal(key);
        if (v != null)
            values.set(key, v);
    }
    return { values, maskedPreview };
}
function interpolateString(input, getter) {
    return input.replace(/\$\{([A-Za-z0-9_.-]+)\}/g, (_, name) => {
        const v = getter(name);
        if (v == null)
            throw new Error(`Missing variable: ${name}`);
        return v;
    });
}
function mask(secret) {
    if (!secret)
        return "";
    if (secret.length <= 4)
        return "••••";
    return secret.slice(0, 2) + "••••" + secret.slice(-2);
}
async function saveVariable(context, v) {
    // Always save into global to keep variables reusable across connections
    const list = context.globalState.get("variables", []) ?? [];
    const next = list.filter(x => x.id !== v.id).concat([{ id: v.id, scope: "user", isSecret: v.isSecret, value: v.isSecret ? undefined : (v.value ?? "") }]);
    await context.globalState.update("variables", next);
    if (v.isSecret && v.value)
        await context.secrets.store(`var:${v.id}`, v.value);
}
async function deleteVariable(context, id) {
    const gs = context.globalState.get("variables", []) ?? [];
    await context.globalState.update("variables", gs.filter(v => v.id !== id));
    await context.secrets.delete(`var:${id}`);
}
async function saveVariablesBulk(context, items) {
    const clean = items.filter(i => i.id && i.id.trim().length > 0).map(i => ({ id: i.id.trim(), scope: "user", value: i.value ?? "" }));
    await context.globalState.update("variables", clean);
}
//# sourceMappingURL=variables.js.map