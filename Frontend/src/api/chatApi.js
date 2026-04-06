export async function sendChatMessage(message, opts = {}) {
  const base = import.meta.env.VITE_API_BASE_URL;
  if (!base) {
    throw new Error("VITE_API_BASE_URL is not set (check your .env).");
  }

  const { signal, conversationId, userId, sessionId } = opts;

  let res;
  try {
    res = await fetch(`${base}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        message,
        conversationId,
        userId,
        sessionId,
      }),
    });
  } catch (e) {
    throw new Error(e?.message || "Network error");
  }

  const data = await res.json().catch(() => ({}));

  // ✅ SMART RESPONSE HANDLING
  let msg = null;

  // 1. FIELD (one-line)
  if (data?.reply) {
    msg = data.reply;
  }

  // 2. LIST (formatted text)
  else if (data?.data?.text) {
    msg = data.data.text;
  }

    // 3. PLANTS (SHOW_PO_PLANTS)
  else if (data?.data?.plants) {
    msg = data.data.plants.map((p) => `Plant: ${p}`).join("\n");
  }

  // 3b. STORAGE LOCATIONS (SHOW_PO_STORAGE_LOCATIONS)
  else if (data?.data?.storage_locations) {
    msg = data.data.storage_locations.map((s) => `Storage Location: ${s}`).join("\n");
  }

  // 3. ITEMS (handle by intent to avoid crashes)
  else if (data?.data?.items) {
    const items = data.data.items;
    const intent = String(data.intent || "").toUpperCase();

    // ✅ SHOW_PO_ITEMS: only show item fields (no qty/price/delivery)
    if (intent === "SHOW_PO_ITEMS") {
        msg = items
          .map((row, i) => {
            const it = row?.item || {};
            return `
  Item ${i + 1}
  PO Item: ${it.po_item || "N/A"}
  Material: ${it.material || "N/A"}
  Text: ${it.short_text || "N/A"}
  Plant: ${it.plant || "N/A"}
  Storage: ${it.storage_location || "N/A"}
  Mat Group: ${it.mat_group || "N/A"}
            `.trim();
          })
          .join("\n----------------\n");
      }
      else if (data?.data?.item) {
    const x = data.data.item;
    msg =
      `Item ${x.po_item}\n` +
      `Short text: ${x.short_text ?? "N/A"}\n` +
      `Material: ${x.material ?? "N/A"}\n` +
      `Storage location: ${x.storage_location ?? "N/A"}\n` +
      `Material group: ${x.mat_group ?? "N/A"}\n` +
      `Quantity: ${x.quantity ?? "N/A"} ${x.quantity_unit ?? ""}`.trim() + "\n" +
      `Net price: ${x.net_price ?? "N/A"} ${x.currency ?? ""}`.trim();
  }

    // ✅ Other intents (e.g., SHOW_PO_DETAILS): show full item info safely
    else {
      msg = items
        .map((row, i) => {
          const it = row?.item || {};
          const qty = row?.quantity || {};
          const pr = row?.pricing || {};
          const del = row?.delivery || {};

          return `
Item ${i + 1}
Material: ${it.material || "N/A"}
PO Item: ${it.po_item || "N/A"}
Plant: ${it.plant || "N/A"}
Storage: ${it.storage_location || "N/A"}
Qty: ${qty.ordered ?? "N/A"} ${qty.unit || ""}
Price: ${pr.net_price ?? "N/A"} ${pr.currency || ""}
Delivery: ${del.delivery_date || "N/A"}
          `.trim();
        })
        .join("\n----------------\n");
    }
  }

  // 4. DELIVERY
  else if (data?.data?.delivery) {
    msg = data.data.delivery
      .map((d, i) => `Delivery ${i + 1}: Date ${d.delivery_date || "N/A"}`)
      .join("\n");
  }

  // 5. PRICING
  else if (data?.data?.pricing) {
    msg = data.data.pricing
      .map((p) => {
        const poItem = p.po_item || "N/A";              // e.g., "00005"
        const displayItem = String(poItem).replace(/^0+/, "") || poItem; // "5" (optional)
        return `Item ${displayItem}: Price ${p.net_price ?? "N/A"} ${p.currency || ""}`;
      })
      .join("\n");
  }

  // 6. ACCOUNTING
  else if (data?.data?.accounting) {
    msg = data.data.accounting
      .map((a, i) => `Item ${i + 1}: Cost Center ${a.cost_center || "N/A"}`)
      .join("\n");
  }

  // 7. FULL PO DETAILS (header summary)
  else if (data?.data?.po_header) {
    const d = data.data;

    msg = `
PO: ${d.po_header.po_no}
Company: ${d.po_header.company_code}
Created By: ${d.po_header.created_by}
Vendor: ${d.vendor?.vendor_id}
Currency: ${d.po_header.currency}
Items: ${d.summary?.item_count}
    `.trim();
  }
  // 8b. ERROR inside data
  else if (data?.data?.error) {
    msg = data.data.error;
  }

  // 8. ERROR (top-level)
  else if (data?.error) {
    msg = data.error;
  }
  // 9. FINAL FALLBACK
  else {
    msg = "No readable response from server";
  }

  if (!res.ok || data?.ok === false) {
    throw new Error(msg);
  }
  else if (data?.data?.measures) {
    // Build structured rows so the UI does NOT need to split reply text (prevents Item 1 being dropped)
    const measuresRows = data.data.measures.map((r) => {
      const item = String(r.po_item || "N/A").replace(/^0+/, "") || r.po_item;

      const parts = [];

      if ("gross_weight" in r) {
        const unit = r.weight_unit || "";
        parts.push(`Gross weight: ${r.gross_weight ?? "N/A"}${unit ? " " + unit : ""}`);
      }

      if ("net_weight" in r) {
        const unit = r.weight_unit || "";
        parts.push(`Net weight: ${r.net_weight ?? "N/A"}${unit ? " " + unit : ""}`);
      }

      // Volume (VOLUM) + Volume unit (VOL_UNIT)
      if ("volume" in r) {
        const unit = r.volume_unit || "";
        parts.push(`Volume: ${r.volume ?? "N/A"}${unit ? " " + unit : ""}`);
      } else if ("volume_unit" in r) {
        parts.push(`Volume unit: ${r.volume_unit ?? "N/A"}`);
      }

      // Material type (MatType)
      if ("mat_type" in r && r.mat_type != null && String(r.mat_type).trim() !== "") {
        parts.push(`Material type: ${r.mat_type}`);
      }

      return {
        item,
        text: `Item ${item} -> ${parts.length ? parts.join(" | ") : "No result found"}`,
        raw: r,
      };
    });

    // Reply string for chat bubble
    msg = measuresRows.map((x) => x.text).join("\n");

    return {
      ok: true,
      reply: msg,
      data: data?.data ?? null,
      meta: data?.meta ?? null,
      raw: data,
      measuresRows, // ✅ UI should render table from this array to avoid dropping first row
    };
  }

  return {
    ok: true,
    reply: msg,
    data: data?.data ?? null,
    meta: data?.meta ?? null,
    raw: data,
  };
}