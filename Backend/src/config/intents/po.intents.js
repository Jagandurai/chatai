/**
 * Intent mapping is config-driven.
 * Each intent defines:
 * - mode: "FIELD" (one-line) or "LIST" or "DETAIL"
 * - paths: fields to extract from transformed structured JSON
 * - template: for one-line response
 */
export const poIntents = {
  // ✅ LIST
  SHOW_PO: {
    mode: "LIST",
    paths: ["headers"],
  },

  // ✅ FULL DETAILS
  SHOW_PO_DETAILS: {
    mode: "DETAIL",
    paths: ["po_header", "vendor", "status_info", "items", "summary"],
  },

  // ✅ ONLY ITEMS
  SHOW_PO_ITEMS: {
    mode: "DETAIL",
    paths: ["items"],
  },

  // ✅ STATUS (one-line)
  SHOW_PO_STATUS: {
    mode: "FIELD",
    paths: ["po_header.po_no", "status_info.status"],
    template: ({ id, data }) =>
      `PO ${id} status is ${data["status_info.status"] || "N/A"}.`,
  },

  // ✅ VENDOR (shortcut)
  SHOW_PO_VENDOR: {
    mode: "FIELD",
    paths: ["po_header.po_no", "vendor.vendor_id"],
    template: ({ id, data }) =>
      `PO ${id} vendor is ${data["vendor.vendor_id"] || "N/A"}.`,
  },

  // ✅ PRICING (FULL LIST OF ITEM PRICES)
  SHOW_PO_PRICING: {
    mode: "DETAIL",
    paths: ["pricing"],
  },

  // ✅ DELIVERY (ALL DELIVERY INFO)
  SHOW_PO_DELIVERY: {
    mode: "DETAIL",
    paths: ["delivery"],
  },

  // ---------------- EXISTING ----------------

  PRICE_INFO: {
    mode: "FIELD",
    paths: [
      "po_header.po_no",
      "po_header.currency",
      "summary.net_price_min",
      "summary.net_price_max",
    ],
    template: ({ id, data }) => {
      const cur = data["po_header.currency"] || "";
      const min = data["summary.net_price_min"];
      const max = data["summary.net_price_max"];

      if (min == null) return `PO ${id} net price is N/A.`;
      if (min === max) return `PO ${id} net price is ${min} ${cur}.`;
      return `PO ${id} net price range is ${min}–${max} ${cur}.`;
    },
  },

  CREATED_BY: {
    mode: "FIELD",
    paths: ["po_header.po_no", "po_header.created_by"],
    template: ({ id, data }) =>
      `PO ${id} was created by ${data["po_header.created_by"] || "N/A"}.`,
  },

  CREATED_DATE: {
    mode: "FIELD",
    paths: ["po_header.po_no", "po_header.created_on"],
    template: ({ id, data }) =>
      `PO ${id} was created on ${data["po_header.created_on"] || "N/A"}.`,
  },

  VENDOR_INFO: {
    mode: "FIELD",
    paths: ["po_header.po_no", "vendor.vendor_id"],
    template: ({ id, data }) =>
      `PO ${id} vendor is ${data["vendor.vendor_id"] || "N/A"}.`,
  },

  DELIVERY_INFO: {
    mode: "FIELD",
    paths: ["po_header.po_no", "summary.delivery_date_earliest"],
    template: ({ id, data }) =>
      `PO ${id} earliest delivery date is ${
        data["summary.delivery_date_earliest"] || "N/A"
      }.`,
  },
};