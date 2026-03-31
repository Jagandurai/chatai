export function formatList({ entity, intent, structured }) {
  const headers = structured?.headers || [];
  const lines = headers.map((h, idx) => {
    return `${idx + 1}) PO ${h.po_no} | Date: ${h.doc_date || h.created_on || "N/A"} | By: ${
      h.created_by || "N/A"
    } | Vendor: ${h.vendor_id || "N/A"} | Cur: ${h.currency || "N/A"} | Status: ${h.status || "N/A"}`;
  });

  return {
    count: headers.length,
    lines,
    text: `${entity} LIST (${headers.length})\n` + lines.join("\n"),
  };
}