import { ApiError } from "../utils/errors.js";
import {
  monthStartEndUTC,
  parseIsoDateRangeFromText,
  parseMonthYearFromText,
  toYyyyMmDd,
} from "./dateFilter.js";

const ALLOWED_ENTITIES = ["PO", "PR", "VENDOR"];

const ALLOWED_INTENTS = [
  "SHOW_PO",
  "SHOW_PO_DETAILS",
  "SHOW_PO_ITEMS",
  "SHOW_PO_STATUS",
  "SHOW_PO_PRICING",
  "SHOW_PO_DELIVERY",
  "SHOW_PO_VENDOR",
  "CREATED_BY",
  "CREATED_DATE",
  "PRICE_INFO",
  "DELIVERY_INFO",
  "VENDOR_INFO",
];

// Don’t allow huge pasted text to go to the router LLM
const MAX_ROUTER_MESSAGE_CHARS = Number(process.env.LLM_ROUTER_MAX_CHARS || 2000);

// If LLM fails, choose a sensible default
function fallbackRouteFromText(msg) {
  const id = extractDocNumber(msg);
  const filters = extractListFilters(msg);

  if (id) {
    const route = { entity: "PO", intent: "SHOW_PO_DETAILS", id, filters: null };
    validateRoute(route);
    return route;
  }

  const route = { entity: "PO", intent: "SHOW_PO", id: null, filters: filters || null };
  validateRoute(route);
  return route;
}

export async function routeMessage({ message }) {
  const msg = String(message || "").trim();
  if (!msg) throw new ApiError(400, "message is required");

  const rule = routeByRules(msg);

  // DEBUG
  console.log("[router] msg =", JSON.stringify(msg));
  console.log("[router] msg.length =", msg.length);
  console.log("[router] rule.confident =", rule.confident, "rule.route =", rule.route);

  // 1) fast path: rule-based
  if (rule.confident) return rule.route;

  // 2) protect LLM from huge pasted content
  if (msg.length > MAX_ROUTER_MESSAGE_CHARS) {
    return fallbackRouteFromText(msg);
  }

  // 3) LLM fallback (but safe)
  console.log("[router] calling ollama...");

  let llmRoute;
  try {
    llmRoute = await routeWithOllama(msg);
  } catch (e) {
    // LLM timeout/invalid/etc -> fallback without hanging the user
    console.warn("[router] ollama routing failed, using fallback:", e?.message || e);
    return fallbackRouteFromText(msg);
  }

  const merged = {
    entity: llmRoute.entity,
    intent: llmRoute.intent,
    id: llmRoute.id || null,
    filters: llmRoute.filters || null,
  };

  // If LLM says SHOW_PO but there is an id in the user text, prefer details.
  // (also protects against weak LLM outputs)
  const idFromText = extractDocNumber(msg);
  if (!merged.id && idFromText) merged.id = idFromText;

  if (merged.id && merged.intent === "SHOW_PO") {
    merged.intent = "SHOW_PO_DETAILS";
  }

  validateRoute(merged);
  return merged;
}

// ------------------- RULE-BASED -------------------
function routeByRules(message) {
  const m = message.toLowerCase();

  const id = extractDocNumber(message);
  const filters = extractListFilters(message);

  // ✅ DETAILS (+ common misspellings)
  // covers: details/detail/full/complete + detials/deteils/detailes
  if (id && /\b(detail|details|detials|deteils|detailes|full|complete|entire)\b/.test(m)) {
    return {
      confident: true,
      route: { entity: "PO", intent: "SHOW_PO_DETAILS", id },
    };
  }

  // ✅ ITEMS
  if (id && /\b(items|line items|materials)\b/.test(m)) {
    return {
      confident: true,
      route: { entity: "PO", intent: "SHOW_PO_ITEMS", id },
    };
  }

  // ✅ STATUS
  if (id && /\b(status|state)\b/.test(m)) {
    return {
      confident: true,
      route: { entity: "PO", intent: "SHOW_PO_STATUS", id },
    };
  }

  // ✅ PRICING
  if (id && /\b(price|pricing|amount|cost)\b/.test(m)) {
    return {
      confident: true,
      route: { entity: "PO", intent: "SHOW_PO_PRICING", id },
    };
  }

  // ✅ DELIVERY
  if (id && /\b(delivery|delivery date)\b/.test(m)) {
    return {
      confident: true,
      route: { entity: "PO", intent: "SHOW_PO_DELIVERY", id },
    };
  }

  // ✅ VENDOR
  if (id && /\b(vendor|supplier)\b/.test(m)) {
    return {
      confident: true,
      route: { entity: "PO", intent: "SHOW_PO_VENDOR", id },
    };
  }

  // ✅ LIST
  if (
    !id &&
    /\b(show|list|display|get)\b/.test(m) &&
    /\b(po|purchase\s*order|purchase\s*orders)\b/.test(m)
  ) {
    return {
      confident: true,
      route: { entity: "PO", intent: "SHOW_PO", id: null, filters },
    };
  }

  if (
    /\b(po|purchase\s*order|purchase\s*orders)\b/.test(m) &&
    /\b(year|month|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/.test(m)
  ) {
    return {
      confident: true,
      route: { entity: "PO", intent: "SHOW_PO", id: null, filters },
    };
  }

  // CREATED BY / CREATED DATE / etc. (existing)
  if (id && /\b(who\s+created|created\s+by)\b/.test(m)) {
    return { confident: true, route: { entity: "PO", intent: "CREATED_BY", id } };
  }

  if (id && /\b(created\s+on|created\s+date|when\s+was)\b/.test(m)) {
    return { confident: true, route: { entity: "PO", intent: "CREATED_DATE", id } };
  }

  if (id && /\b(price|net\s*price|cost|amount|rate)\b/.test(m)) {
    return { confident: true, route: { entity: "PO", intent: "PRICE_INFO", id } };
  }

  if (id && /\b(delivery|deliver|delivery\s*date)\b/.test(m)) {
    return { confident: true, route: { entity: "PO", intent: "DELIVERY_INFO", id } };
  }

  return {
    confident: false,
    route: { entity: "PO", intent: "SHOW_PO", id: null, filters },
  };
}

// ------------------- HELPERS -------------------
function extractDocNumber(message) {
  const ten = message.match(/\b\d{10}\b/);
  if (ten) return ten[0];
  const any = message.match(/\b\d{6,12}\b/);
  return any ? any[0] : null;
}

function extractListFilters(message) {
  const m = String(message || "").toLowerCase();
  const filters = {};

  // --- Relative time phrases: last month / this month ---
  if (/\blast\s+month\b/.test(m)) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const mon = now.getUTCMonth() + 1; // 1..12

    const prevMon = mon === 1 ? 12 : mon - 1;
    const prevYear = mon === 1 ? y - 1 : y;

    const { start, end } = monthStartEndUTC(prevYear, prevMon);
    filters.docDateFrom = toYyyyMmDd(start);
    filters.docDateTo = toYyyyMmDd(end);
  } else if (/\bthis\s+month\b/.test(m) || /\bcurrent\s+month\b/.test(m)) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const mon = now.getUTCMonth() + 1;
    const { start, end } = monthStartEndUTC(y, mon);
    filters.docDateFrom = toYyyyMmDd(start);
    filters.docDateTo = toYyyyMmDd(end);
  }

  // month/year parsing (jan 2026, year 2019, etc.)
  const my = parseMonthYearFromText(message);
  if (my) {
    const { month, year } = my;

    if (month && year) {
      const { start, end } = monthStartEndUTC(year, month);
      filters.docDateFrom = toYyyyMmDd(start);
      filters.docDateTo = toYyyyMmDd(end);
    } else if (month && !year) {
      filters.monthOnly = month;
    } else if (!month && year) {
      const start = new Date(Date.UTC(year, 0, 1));
      const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59));

      filters.docDateFrom = toYyyyMmDd(start);
      filters.docDateTo = toYyyyMmDd(end);
    }
  }

  const range = parseIsoDateRangeFromText(message);
  if (range) {
    filters.docDateFrom = toYyyyMmDd(range.start);
    filters.docDateTo = toYyyyMmDd(range.end);
  }

  // FIX: createdBy should not capture the word vendor/supplier
  const createdBy = message.match(/\bcreated\s+by\s+([a-zA-Z0-9_]+)/i);
  if (createdBy && createdBy[1]) {
    const val = createdBy[1];
    if (!/^(vendor|supplier)$/i.test(val)) {
      filters.createdBy = val;
    }
  }

  // vendor id like "vendor 17300001"
  const vendor = message.match(/\b(vendor|supplier)\s+(\d{4,12})\b/i);
  if (vendor && vendor[2]) filters.vendorId = vendor[2];

  const status = message.match(/\bstatus\s+([a-zA-Z0-9_]+)\b/i);
  if (status && status[1]) filters.status = status[1];

  const limitMatch = message.match(/\b(last|top)\s+(\d+)\b/i);
  if (limitMatch) {
    filters.limit = Number(limitMatch[2]);
  }

  return Object.keys(filters).length ? filters : null;
}

function mergeFilters(a, b) {
  if (!a && !b) return null;
  return { ...(b || {}), ...(a || {}) };
}

// ------------------- OLLAMA -------------------

async function routeWithOllama(message) {
  const prompt = buildPrompt(message);
  console.log("[router] prompt.length =", prompt.length);

  const url = process.env.OLLAMA_URL || "http://localhost:11434/api/generate";
  const model = process.env.OLLAMA_MODEL || "llama3:latest";

  // Make routing fast (don’t allow it to run for minutes)
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 8000); // try 8000ms first

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,

        // ✅ These options are the key for speed
        options: {
          temperature: 0,
          num_predict: 128,          // routing JSON is tiny
          top_p: 0.9,
          top_k: 20,
          repeat_penalty: 1.05,
          // stop as soon as JSON object ends (prevents extra text)
          stop: ["}\n", "}\r\n", "}"],
        },
      }),
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new ApiError(502, `Ollama error ${resp.status}: ${t.slice(0, 300)}`);
    }

    const json = await resp.json();
    const parsed = safeJsonFromText(json?.response);

    if (!parsed) throw new ApiError(500, "LLM returned invalid JSON.");
    return parsed;
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new ApiError(504, `LLM routing timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function buildPrompt(message) {
  return `
Return ONLY JSON.

Schema:
{
  "entity":"PO|PR|VENDOR",
  "intent":"SHOW_PO|SHOW_PO_DETAILS|SHOW_PO_ITEMS|SHOW_PO_STATUS|SHOW_PO_PRICING|SHOW_PO_DELIVERY|SHOW_PO_VENDOR|CREATED_BY|CREATED_DATE|PRICE_INFO|DELIVERY_INFO|VENDOR_INFO",
  "id":"string or null",
  "filters":{...} or null
}

Rules:
- If a 10-digit number is present and the message mentions PO/purchase order, set entity="PO" and id to that number.
- Prefer SHOW_PO_DETAILS when user asks for details/full/complete info.
- Prefer SHOW_PO_VENDOR/STATUS/ITEMS/PRICING/DELIVERY when those words appear.
- If no id, SHOW_PO (list).

User message:
${JSON.stringify(message)}
`.trim();
}

function safeJsonFromText(text) {
  const s = String(text || "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ------------------- VALIDATION -------------------
function validateRoute(route) {
  if (!ALLOWED_ENTITIES.includes(route.entity)) {
    throw new ApiError(400, "Unsupported entity.");
  }
  if (!ALLOWED_INTENTS.includes(route.intent)) {
    throw new ApiError(400, "Unsupported intent.");
  }
  if (route.intent !== "SHOW_PO" && !route.id) {
    throw new ApiError(400, "Document number missing.");
  }
}