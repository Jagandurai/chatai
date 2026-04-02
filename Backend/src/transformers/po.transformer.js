import { parseODataAtomXml } from "./xml/odataAtomXml.parser.js";
import { toISODate } from "../utils/date.js";

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const poTransformer = {
  async transform({ xml, id, intent, filters }) {
    const rows = await parseODataAtomXml(xml);

    // LIST: PO list (with paging + filters)
    if (intent === "SHOW_PO") {
      let headers = buildHeaderList(rows);
      headers = applyHeaderFilters(headers, filters);

      const skip = Math.max(0, Number(filters?.skip || 0));
      const defaultTake = Number(process.env.PO_LIST_TAKE || 20);
      const take = Math.max(1, Number(filters?.limit || defaultTake));
      const page = headers.slice(skip, skip + take);

      return {
        headers: page,
        page: {
          skip,
          take,
          returned: page.length,
          totalMatched: headers.length,
          hasMore: skip + take < headers.length,
        },
      };
    }

    // FIELD: count only
    if (intent === "COUNT_PO") {
      let headers = buildHeaderList(rows);
      headers = applyHeaderFilters(headers, filters);
      return { count: headers.length };
    }

    const details = buildPoDetails(rows, id);

    switch (intent) {
      case "SHOW_PO_DETAILS":
        return details;

      case "SHOW_PO_VENDOR":
        return { vendor: details.vendor };

      case "SHOW_PO_HEADER":
        return { po_header: details.po_header };

      // Items (kept full for frontend compatibility)
      case "SHOW_PO_ITEMS":
        return {
          items: details.items.map((x) => ({
            item: x.item,
            quantity: x.quantity,
            pricing: x.pricing,
            delivery: x.delivery,
          })),
        };

      // Unique plants
      case "SHOW_PO_PLANTS": {
        const plants = [
          ...new Set(
            (details.items || [])
              .map((x) => x?.item?.plant)
              .filter(Boolean)
          ),
        ];
        return { plants };
      }


      case "SHOW_PO_PROFIT_CENTER":
        return { 
          profit_center: details.po_header.profit_center 
        };

      // Unique storage locations
      case "SHOW_PO_STORAGE_LOCATIONS": {
        const storage_locations = [
          ...new Set(
            (details.items || [])
              .map((x) => x?.item?.storage_location)
              .filter(Boolean)
          ),
        ];
        return { storage_locations };
      }

      case "SHOW_PO_MEASURES": {
        const fields = Array.isArray(filters?.fields) ? filters.fields : null;
        const want = (k) => !fields || fields.includes(k);

        return {
          measures: details.items.map((x) => {
            const out = {
              po_item: x?.item?.po_item,
              material: x?.item?.material,
              mat_type: x?.mat_type ?? null,           // ✅ add
              weight_unit: x?.measures?.weight_unit ?? null,
            };

            if (want("NET_WEIGHT")) out.net_weight = x?.measures?.net_weight ?? null;
            if (want("GROSS_WEIGHT")) out.gross_weight = x?.measures?.gross_weight ?? null;
            if (want("VOLUME")) out.volume = x?.measures?.volume ?? null;
            // include unit if they asked volume OR asked unit
            if (want("VOLUME") || want("VOL_UNIT")) {
              out.volume_unit = x?.measures?.volume_unit ?? null;
            }

            out.volume_unit = x?.measures?.volume_unit ?? null;

            return out;
          }),
        };
      }

      case "SHOW_PO_PRICING": {
        const poItem = filters?.poItem ? String(filters.poItem) : null;

        let items = details.items || [];

        // if item specified, filter down
        if (poItem) {
          items = items.filter((x) => String(x?.item?.po_item) === poItem);
        }

        if (poItem && items.length === 0) {
          return { error: `PO item ${poItem} not found in PO ${id}` };
        }

        // If no item specified and too many items, return last 10 (optional)
        const maxItems = Number(process.env.PO_PRICING_MAX_ITEMS || 10);
        if (!poItem && items.length > maxItems) {
          items = items.slice(0, maxItems);
        }

        return {
          pricing: items.map((x) => ({
            po_item: x?.item?.po_item,
            net_price: x?.pricing?.net_price,
            currency: x?.pricing?.currency,
            price_unit: x?.pricing?.price_unit,
          })),
        };
      }
      
      case "SHOW_PO_TAX_CODE":
        return { tax_code: details.po_header.purchase_cd_tax };

      case "SHOW_PO_DELIVERY":
        return { delivery: details.items.map((i) => i.delivery) };

      case "SHOW_PO_ACCOUNTING":
        return { accounting: details.items.map((i) => i.accounting) };

      default:
        // ✅ IMPORTANT: return full details so FIELD intents can pickPaths()
        return details;
    }
  },
};

function buildHeaderList(rows) {
  const byPo = new Map();

  for (const r of rows) {
    const po = r.PoNo;
    if (!po) continue;

    if (!byPo.has(po)) {
      byPo.set(po, {
        po_no: po,
        created_on: toISODate(r.CrtDate || r.PoDocDate),
        doc_date: toISODate(r.PoDocDate),
        created_by: r.UserCreated || null,
        vendor_id: r.SuppAcoutNo || null,
        currency: r.CurKey || null,
        status: r.Status || null,
      });
    }
  }

  return Array.from(byPo.values()).sort((a, b) => {
    const da = a.doc_date || a.created_on || "";
    const db = b.doc_date || b.created_on || "";
    return String(db).localeCompare(String(da));
  });
}

function applyHeaderFilters(headers, filters) {
  if (!filters) return headers;

  let out = headers;

  if (filters.monthOnly) {
    out = out.filter((h) => {
      // Prefer created_on for "created" questions; fallback to doc_date
      const d = h.created_on || h.doc_date;
      if (!d) return false;
      return new Date(d).getUTCMonth() + 1 === filters.monthOnly;
    });
  }

  if (filters.docDateFrom && filters.docDateTo) {
    out = out.filter((h) => {
      // Prefer created_on for "created" questions; fallback to doc_date
      const d = h.created_on || h.doc_date;
      if (!d) return false;
      return d >= filters.docDateFrom && d <= filters.docDateTo;
    });
  }

  if (filters.createdBy) {
    out = out.filter((h) => {
      if (!h.created_by) return false;
      return h.created_by
        .toLowerCase()
        .includes(String(filters.createdBy).toLowerCase());
    });
  }

  if (filters.vendorId) {
    out = out.filter((h) => String(h.vendor_id || "") === String(filters.vendorId));
  }

  if (filters.status) {
    out = out.filter((h) =>
      String(h.status || "")
        .toLowerCase()
        .includes(String(filters.status).toLowerCase())
    );
  }

  return out;
}
function buildPoDetails(rows, poNo) {
  const filtered = rows.filter((r) => String(r.PoNo) === String(poNo));
  const first = filtered[0] || null;

  const out = {
    po_header: {
      po_no: poNo || first?.PoNo || null,
      company_code: first?.CompanyCode || null,
      doc_catg: first?.PoDocCatg || null,
      doc_type: first?.PoDocType || null,
      po_org: first?.PoOrg || null,
      payment_terms: first?.TermsPymntKey || null,
      discount_days: num(first?.DicountDays),
      po_group: first?.PoGrp || null,
      currency: first?.CurKey || null,
      exchange_rate: first?.ExcngRate || null,
      doc_date: toISODate(first?.PoDocDate),
      created_on: toISODate(first?.CrtDate),
      purchase_cd_tax: first?.PurchaseCdTax || null,
      created_by: first?.UserCreated || null,
      profit_center: first?.ProfitCenter ? String(first.ProfitCenter).trim() : null,
    },

    vendor: { vendor_id: first?.SuppAcoutNo || null },

    status_info: {
      status: first?.Status || null,
      purchasing_doc_pr_st: first?.PurchasingDocPrSt || null,
      delivery_indicator: first?.DelivInd ?? null,
      rel_not_yet: first?.RelNotYet ?? null,
    },

    items: filtered.map((r) => ({
      item: {
        po_item: r.PoItem || null,
        material: r.MatNo || null,
        short_text: r.ShortText || null,
        plant: r.Plant || null,
        storage_location: r.StrLoc || null,
        mat_group: r.MatGrp || null,
      },

      // ✅ ADDED: weights/volume + units (per item)
      measures: {
        net_weight: num(r.Ntgew),
        gross_weight: num(r.Brgew),
        volume: num(r.Volum),
        volume_unit: r.VolUnit || null,
        weight_unit: r.UnitOfWt || null,
      },

      // ✅ OPTIONAL: material type (per item)
      mat_type: r.MatType || null,

      quantity: { ordered: num(r.Menge), unit: r.UnitOfMeasure || null },

      pricing: {
        net_price: num(r.NetPrice),
        price_unit: num(r.PriceUnit),
        currency: r.CurKey || null,
      },

      delivery: {
        delivery_date: toISODate(r.ItemDeliDt),
        schedule: r.DeliverySchedule || null,
      },

      accounting: {
        cost_center: r.CostCenter || null,
        gl_account: r.GlActNo || null,
        wbs_element: r.WbsElement || null,
        profit_center: r.ProfitCenter || null,
      },
    })),
  };

  out.summary = computeSummary(out);
  return out;
}

function computeSummary(structured) {
  const items = structured.items || [];
  const prices = items.map((x) => x?.pricing?.net_price).filter((v) => typeof v === "number");
  const dates = items.map((x) => x?.delivery?.delivery_date).filter(Boolean).sort();

  return {
    net_price_min: prices.length ? Math.min(...prices) : null,
    net_price_max: prices.length ? Math.max(...prices) : null,
    delivery_date_earliest: dates.length ? dates[0] : null,
    item_count: items.length,
  };
}