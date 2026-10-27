// SAP MCP server (stdio). Talks to the BTP iFlow ZMCP_Gateway.
//   OData tools (always on):  list_services, get_metadata, query_entity_set   -> op=catalog|metadata|query
//   RFC tools (RFC_ENABLED=true): one tool per entry of functions.mjs          -> op=function
// RULE: never use console.log here. stdout carries the MCP protocol; log to stderr only.
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { XMLParser } from "fast-xml-parser";
import { FUNCTIONS } from "./functions.mjs";

// Standalone use (npm run inspect): load the project's root .env if present.
// When CAP starts this server, the parent process already passes all variables, and none are overridden.
try { process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url))); } catch { /* no .env file */ }

const { TOKEN_URL, CLIENT_ID, CLIENT_SECRET, RUNTIME_URL } = process.env;
const GATEWAY_PATH = process.env.GATEWAY_PATH || "/http/zmcp/gateway";
const RFC_ENABLED = String(process.env.RFC_ENABLED || "").toLowerCase() === "true";

// ---------------- OData allow-list (the iFlow holds the first copy; keep both in sync) ----------------
const ALLOWED = {
  API_PURCHASEORDER_PROCESS_SRV: ["A_PurchaseOrder", "A_PurchaseOrderItem"],
};

// ---------------- RFC safety: second line of defence (the iFlow must enforce the same rules) ----------------
const WRITE_WORDS = /(CREATE|CHANGE|POST|DELETE|UPDATE|SAVE|COMMIT|INSERT|MODIFY|CANCEL|REVERSE)/i;
const GETTER = /^(BAPI_[A-Z0-9_]*(GET|READ|DETAIL|LIST|DISPLAY)[A-Z0-9_]*|STFC_CONNECTION)$/;
function assertReadOnly(rfc) {
  if (!/^[A-Z0-9_\/]{3,30}$/.test(rfc)) throw new Error(`Invalid RFC name ${rfc}`);
  if (WRITE_WORDS.test(rfc)) throw new Error(`RFC ${rfc} contains a write word and is refused`);
  if (!GETTER.test(rfc)) throw new Error(`RFC ${rfc} does not look like a read-only getter and is refused`);
}
const rfcTools = RFC_ENABLED ? FUNCTIONS : [];
for (const f of rfcTools) assertReadOnly(f.rfc); // fail at startup, never at question time

// ---------------- Instructions for the model (sent to the MCP client, used in the system prompt) ----------------
const INSTRUCTIONS = [
  "ODATA (lists and documents):",
  "- Service API_PURCHASEORDER_PROCESS_SRV, entity sets A_PurchaseOrder and A_PurchaseOrderItem, tool query_entity_set.",
  "- A_PurchaseOrder fields: PurchaseOrder, CompanyCode, Supplier, CreationDate, PurchaseOrderType, PurchasingGroup, PurchasingOrganization, DocumentCurrency.",
  "- A_PurchaseOrderItem fields: PurchaseOrder, PurchaseOrderItem, PurchaseOrderItemText, Plant, Material, OrderQuantity, NetPriceAmount.",
  "- Need other fields? Call get_metadata with service and entity first.",
  "- Always pass select (only needed fields). Use top 10 unless asked for more (max 50).",
  "- Filters are OData V2 with quoted strings: CompanyCode eq '2120'. Dates: CreationDate ge datetime'2012-01-01T00:00:00'.",
  ...(rfcTools.length
    ? ["", "RFC FUNCTIONS (one object by its key):", ...rfcTools.map((f) => "- " + f.hint),
       "- Pass identifiers exactly as the user typed them. Do not add or remove leading zeros."]
    : []),
].join("\n");

// ---------------- OAuth token with caching ----------------
let token = null;
let tokenExpiry = 0;
async function getToken() {
  if (token && Date.now() < tokenExpiry - 60_000) return token;
  if (!TOKEN_URL || !CLIENT_ID || !CLIENT_SECRET) throw new Error("TOKEN_URL, CLIENT_ID or CLIENT_SECRET is missing in the configuration (.env locally, service ask-sap-config on BTP)");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  const j = await res.json();
  token = j.access_token;
  tokenExpiry = Date.now() + (j.expires_in ?? 300) * 1000;
  return token;
}

// ---------------- Call the iFlow ----------------
async function callGateway(params) {
  if (!RUNTIME_URL) throw new Error("RUNTIME_URL is missing in the configuration (.env locally, service ask-sap-config on BTP)");
  const url = RUNTIME_URL.replace(/\/$/, "") + GATEWAY_PATH + "?" + new URLSearchParams(params);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}`, Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${text.slice(0, 500)}`);
  return text;
}

// ---------------- Cleaning helpers ----------------
const DATE_RE = /^\/Date\((-?\d+)\)\/$/;
function clean(v) {
  if (typeof v === "string") {
    const m = v.match(DATE_RE);
    return m ? new Date(parseInt(m[1], 10)).toISOString().slice(0, 10) : v;
  }
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, val] of Object.entries(v)) if (k !== "__metadata") o[k] = clean(val);
    return o;
  }
  return v;
}

// Removes empty values (and optionally zero values) from an RFC answer so the model sees only real data.
const ZERO = /^[+-]?0+([.,]0+)?$|^0000-00-00$|^00000000$/;
function prune(v, dropZeros) {
  if (Array.isArray(v)) {
    const a = v.map((x) => prune(x, dropZeros)).filter((x) => x !== undefined);
    return a.length ? a : undefined;
  }
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      const p = prune(val, dropZeros);
      if (p !== undefined) o[k] = p;
    }
    return Object.keys(o).length ? o : undefined;
  }
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "" || (dropZeros && ZERO.test(s))) return undefined;
    return s;
  }
  if (typeof v === "number" && dropZeros && v === 0) return undefined;
  return v;
}

const out = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }] });
const fail = (e) => ({ isError: true, content: [{ type: "text", text: String(e.message || e) }] });

// ---------------- Server and tools ----------------
const server = new McpServer({ name: "sap-gateway", version: "0.2.0" }, { instructions: INSTRUCTIONS });

// ===== OData tools =====
server.registerTool(
  "list_services",
  {
    description: "List the SAP OData services available. Only services with allowed=true can be queried.",
    inputSchema: {},
    _meta: { via: "odata" },
  },
  async () => {
    try {
      const j = JSON.parse(await callGateway({ op: "catalog" }));
      const rows = (j.d?.results ?? []).map((r) => {
        const name = r.TechnicalServiceName ?? r.ID;
        return { name, title: r.Title, allowed: name in ALLOWED };
      });
      rows.sort((a, b) => Number(b.allowed) - Number(a.allowed));
      return out(rows.slice(0, 15));
    } catch (e) { return fail(e); }
  }
);

server.registerTool(
  "get_metadata",
  {
    description:
      "Get the field names and types of one entity set of an allowed SAP OData service. " +
      "Call this before query_entity_set when you are unsure of exact field names. Pass entity to keep the answer short.",
    inputSchema: {
      service: z.string().describe("Technical service name, e.g. API_PURCHASEORDER_PROCESS_SRV"),
      entity: z.string().optional().describe("Entity set, e.g. A_PurchaseOrder. Omit to get the list of entity sets only."),
    },
    _meta: { via: "odata" },
  },
  async ({ service, entity }) => {
    try {
      if (!ALLOWED[service]) throw new Error("Service not allowed");
      if (entity && !ALLOWED[service].includes(entity)) throw new Error("Entity not allowed");
      const xml = await callGateway({ op: "metadata", service });
      const p = new XMLParser({
        ignoreAttributes: false, attributeNamePrefix: "@_",
        isArray: (n) => ["EntityType", "Property", "EntitySet", "Schema"].includes(n),
      });
      const schema = p.parse(xml)["edmx:Edmx"]["edmx:DataServices"].Schema[0];
      const types = Object.fromEntries(schema.EntityType.map((t) => [
        t["@_Name"], t.Property.map((x) => `${x["@_Name"]}:${x["@_Type"].replace("Edm.", "")}`),
      ]));
      const sets = schema.EntityContainer.EntitySet
        .filter((s) => ALLOWED[service].includes(s["@_Name"]))
        .map((s) => ({ entity: s["@_Name"], fields: types[s["@_EntityType"].split(".").pop()] }));
      if (!entity) return out(sets.map((s) => ({ entity: s.entity, fieldCount: s.fields.length })));
      return out(sets.filter((s) => s.entity === entity));
    } catch (e) { return fail(e); }
  }
);

server.registerTool(
  "query_entity_set",
  {
    description:
      "Read rows from an allowed SAP OData entity set (read-only, max 50 rows). " +
      "filter uses OData V2 syntax, e.g. CompanyCode eq '2120' and Supplier eq '10507076'. " +
      "Dates in filters need the form CreationDate ge datetime'2012-01-01T00:00:00'. " +
      "Always pass select with only the fields needed. Dates in results are YYYY-MM-DD.",
    inputSchema: {
      service: z.string(),
      entity: z.string().describe("Entity set, e.g. A_PurchaseOrder"),
      select: z.string().optional().describe("Comma-separated fields, e.g. PurchaseOrder,Supplier,CompanyCode"),
      filter: z.string().optional(),
      top: z.number().int().min(1).max(50).optional(),
    },
    _meta: { via: "odata" },
  },
  async ({ service, entity, select, filter, top }) => {
    try {
      if (!ALLOWED[service]?.includes(entity)) throw new Error("Service or entity not allowed");
      const params = { op: "query", service, entity, top: String(top ?? 10) };
      if (select) params.select = select.replace(/\s+/g, "");
      if (filter) params.filter = filter;
      const j = JSON.parse(await callGateway(params));
      return out(clean(j.d?.results ?? []));
    } catch (e) { return fail(e); }
  }
);

// ===== RFC tools: one per registry entry (only when RFC_ENABLED=true) =====
for (const f of rfcTools) {
  server.registerTool(
    f.tool,
    { description: f.description, inputSchema: f.input, _meta: { via: "rfc" } },
    async (args) => {
      try {
        const importParams = f.toRfc(args);
        const text = await callGateway({ op: "function", fn: f.rfc, p: JSON.stringify(importParams) });
        const j = JSON.parse(text);
        if (j.ok === false) throw new Error(j.error?.message || j.error?.code || "The RFC call failed");

        // Tolerate small differences in how the iFlow wraps the answer.
        let data = j.export ?? j.data ?? j;
        if (data === j) { const { ok, function: _fn, ...rest } = j; data = rest; }
        if (f.exports) data = Object.fromEntries(Object.entries(data).filter(([k]) => f.exports.includes(k)));

        // SAP reports business errors in RETURN (TYPE E or A). Return them plainly, without the empty structures.
        const ret = [].concat(data.RETURN ?? j.return ?? []).filter(Boolean);
        const err = ret.find((r) => ["E", "A"].includes(String(r.TYPE ?? r.type ?? "").toUpperCase()));
        if (err) {
          const code = err.CODE || [err.ID, err.NUMBER].filter(Boolean).join(" ");
          throw new Error(`SAP says: ${err.MESSAGE ?? err.message}${code ? ` (${code})` : ""}`);
        }
        delete data.RETURN;
        return out(prune(clean(data), f.dropZeros) ?? { result: "SAP returned no data." });
      } catch (e) { return fail(e); }
    }
  );
}

await server.connect(new StdioServerTransport());
console.error(`sap-gateway MCP server running (RFC tools: ${rfcTools.map((f) => f.tool).join(", ") || "off"})`);
