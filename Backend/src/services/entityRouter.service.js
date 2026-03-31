import { ApiError } from "../utils/errors.js";
import { entityRegistry } from "../config/entities.registry.js";
import { resolveIntentPaths } from "../extractors/intentFieldResolver.js";
import { pickPaths } from "../extractors/fieldExtractor.js";
import { formatOneLine } from "../formatters/oneLine.formatter.js";
import { formatList } from "../formatters/list.formatter.js";

export const entityRouterService = {
  async handle({ entity, intent, id, filters }) {
    const e = String(entity || "").toUpperCase();
    const i = String(intent || "").toUpperCase();

    const entry = entityRegistry[e];
    if (!entry) throw new ApiError(400, `Unsupported entity: ${entity}`);

    const intentDef = entry.intents[i];
    if (!intentDef) throw new ApiError(400, `Unsupported intent "${intent}" for entity "${entity}".`);

    // LIST mode does not require id
    if (intentDef.mode !== "LIST" && !id) {
      throw new ApiError(400, `id is required for intent "${intent}" (entity "${entity}").`);
    }

    // Fetch raw XML (pass filters down)
    const xml = await entry.service.fetch({ id, intent: i, filters });

    // Transform to structured JSON (pass filters down)
    const structured = await entry.transformer.transform({ xml, id, intent: i, filters });

    // Extract only when needed
    let data = null;

    if (intentDef.mode === "FIELD") {
      const paths = resolveIntentPaths(intentDef);
      data = pickPaths(structured, paths);
    }
    // Format response

    // ✅ LIST → table/list
    if (intentDef.mode === "LIST") {
      return {
        entity: e,
        intent: i,
        filters: filters || null,
        data: formatList({ entity: e, intent: i, structured }),
      };
    }

    // ✅ FIELD → one-line answer (who created, price, etc.)
    if (intentDef.mode === "FIELD") {
      return {
        entity: e,
        intent: i,
        filters: filters || null,
        data,
        reply: formatOneLine({ entity: e, intent: i, id, data, intentDef }),
      };
    }

    // ✅ DETAIL → full structured response (NO one-line)
    if (intentDef.mode === "DETAIL") {
      return {
        entity: e,
        intent: i,
        filters: filters || null,
        data: structured, // 🔥 IMPORTANT: return full structured data
      };
    }

    return {
      entity: e,
      intent: i,
      filters: filters || null,
      data,
      reply: formatOneLine({ entity: e, intent: i, id, data, intentDef }),
    };
  },
};