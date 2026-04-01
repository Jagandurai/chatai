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

    const details = buildPoDetails(rows, id);

    switch (intent) {
      case "SHOW_PO_DETAILS":
        return details;

      case "SHOW_PO_VENDOR":
        return { vendor: details.vendor };

      case "SHOW_PO_HEADER":
        return { po_header: details.po_header };

      case "SHOW_PO_ITEMS":
        return {
          items: details.items.map((x) => ({
            item: x.item,
            quantity: x.quantity,
            pricing: x.pricing,   // ✅ add this to satisfy pricing.net_price
            delivery: x.delivery, // ✅ add if your UI reads delivery_date too
          })),
        };

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

      case "SHOW_PO_PRICING":
        return { pricing: details.items.map((i) => i.pricing) };

      case "SHOW_PO_DELIVERY":
        return { delivery: details.items.map((i) => i.delivery) };

      case "SHOW_PO_ACCOUNTING":
        return { accounting: details.items.map((i) => i.accounting) };
      
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
      const d = h.doc_date || h.created_on;
      if (!d) return false;
      return new Date(d).getUTCMonth() + 1 === filters.monthOnly;
    });
  }

  if (filters.docDateFrom && filters.docDateTo) {
    out = out.filter((h) => {
      const d = h.doc_date || h.created_on;
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
      created_by: first?.UserCreated || null,
      payment_terms: first?.TermsPymntKey || null,
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
      quantity: { ordered: num(r.Menge), unit: r.UnitOfMeasure || null },
      pricing: { net_price: num(r.NetPrice), price_unit: num(r.PriceUnit), currency: r.CurKey || null },
      delivery: { delivery_date: toISODate(r.ItemDeliDt), schedule: r.DeliverySchedule || null },
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