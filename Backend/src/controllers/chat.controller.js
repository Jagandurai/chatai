import { entityRouterService } from "../services/entityRouter.service.js";
import { routeMessage } from "../llm/llm.router.js";

function isGreeting(message) {
  const m = String(message || "").trim().toLowerCase();
  return ["hi", "hello", "hey", "hii", "hai", "help", "start"].includes(m);
}

// ------------------- Simple in-memory pagination store -------------------
// Keyed by user (req.body.user) if provided, else by IP.
// In production with multiple servers, move this to Redis.
const listStateBySession = new Map();

function getSessionKey(req) {
  const user = String(req.body?.user || "").trim();
  if (user) return `user:${user}`;
  return `ip:${req.ip}`;
}

function parseNextRequest(message) {
  const m = String(message || "").trim().toLowerCase();

  // Examples to support:
  // "next"
  // "next 10"
  // "show next 10 po"
  // "more"
  // "more 20"
  const isNext =
    /\b(next|more)\b/.test(m) ||
    /\bshow\s+next\b/.test(m) ||
    /\bshow\s+more\b/.test(m);

  if (!isNext) return null;

  const n = m.match(/\b(next|more)\s+(\d+)\b/);
  const take = n ? Number(n[2]) : 10; // default 10
  if (!Number.isFinite(take) || take <= 0) return null;

  return { take };
}

export async function chatController(req, res, next) {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) {
      return res
        .status(400)
        .json({ ok: false, reply: "Message is required", error: "Message is required" });
    }

    if (isGreeting(message)) {
      return res.json({
        ok: true,
        reply:
          "Hi! Try: 'show po', 'show po in jan', 'show po in january 2026', 'show po vendor 17300001', 'who created PO 4500000066', 'show po in the year of 2019', then 'next 10'.",
      });
    }

    const sessionKey = getSessionKey(req);

    // 1) Handle "next" / "more" continuity BEFORE normal routing
    const nextReq = parseNextRequest(message);
    if (nextReq) {
      const state = listStateBySession.get(sessionKey);

      // If no previous list state, tell user what to do.
      if (!state || state.entity !== "PO" || state.intent !== "SHOW_PO") {
        return res.status(400).json({
          ok: false,
          message,
          reply: "No previous PO list found. First run something like: 'show po in the year of 2019', then say 'next 10'.",
          error: "NO_PREVIOUS_LIST",
        });
      }

      const routed = {
        entity: state.entity,
        intent: state.intent,
        id: null,
        filters: {
          ...(state.filters || null),
          skip: state.skip + (state.take || 0), // advance by previous take
          limit: nextReq.take, // how many user wants now
        },
      };

      const result = await entityRouterService.handle(routed);

      // Update state
      listStateBySession.set(sessionKey, {
        entity: "PO",
        intent: "SHOW_PO",
        filters: state.filters || null, // keep original filters (year, vendor, status...)
        skip: routed.filters.skip,
        take: nextReq.take,
        updatedAt: Date.now(),
      });

      return res.json({
        ok: true,
        message,
        routed,
        ...result,
      });
    }

    // 2) Normal routing
    const routed = await routeMessage({ message });
    
    // ensure filters exists for SHOW_PO / COUNT_PO
    if (routed?.entity === "PO" && (routed?.intent === "SHOW_PO" || routed?.intent === "COUNT_PO")) {
      routed.filters = routed.filters || null;
    }

    // apply paging defaults ONLY for SHOW_PO
    if (routed?.entity === "PO" && routed?.intent === "SHOW_PO") {
      const take = Number(routed.filters?.limit || 10);
      const skip = Number(routed.filters?.skip || 0);

      routed.filters = {
        ...(routed.filters || {}),
        limit: Number.isFinite(take) ? take : 10,
        skip: Number.isFinite(skip) ? skip : 0,
      };
    }
    const result = await entityRouterService.handle(routed);

    // 3) Save list state AFTER successful list response
    if (routed?.entity === "PO" && routed?.intent === "SHOW_PO") {
      // Store original filters but remove paging so "next" is consistent
      const { skip, limit, ...baseFilters } = routed.filters || {};
      listStateBySession.set(sessionKey, {
        entity: "PO",
        intent: "SHOW_PO",
        filters: Object.keys(baseFilters).length ? baseFilters : null,
        skip: Number(skip || 0),
        take: Number(limit || 10),
        updatedAt: Date.now(),
      });
    }

    return res.json({
      ok: true,
      message,
      routed,
      ...result,
    });
  } catch (err) {
    next(err);
  }
}