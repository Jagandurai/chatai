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

  else if (data?.data?.items) {
  msg = data.data.items
    .map((item, i) => {
      return `
Item ${i + 1}
Material: ${item.item.material || "N/A"}
PO Item: ${item.item.po_item || "N/A"}
Plant: ${item.item.plant || "N/A"}
Storage: ${item.item.storage_location || "N/A"}
Qty: ${item.quantity.ordered ?? "N/A"} ${item.quantity.unit || ""}
Price: ${item.pricing.net_price ?? "N/A"} ${item.pricing.currency || ""}
Delivery: ${item.delivery.delivery_date || "N/A"}
      `.trim();
    })
    .join("\n----------------\n");
}
  // 4. DELIVERY (🔥 FIX)
  else if (data?.data?.delivery) {
    msg = data.data.delivery
      .map(
        (d, i) =>
          `Delivery ${i + 1}: Date ${d.delivery_date || "N/A"}`
      )
      .join("\n");
  }

  // 5. PRICING (optional but useful)
  else if (data?.data?.pricing) {
    msg = data.data.pricing
      .map(
        (p, i) =>
          `Item ${i + 1}: Price ${p.net_price ?? "N/A"} ${p.currency || ""}`
      )
      .join("\n");
  }

  // 6. ACCOUNTING (optional)
  else if (data?.data?.accounting) {
    msg = data.data.accounting
      .map(
        (a, i) =>
          `Item ${i + 1}: Cost Center ${a.cost_center || "N/A"}`
      )
      .join("\n");
  }

  // 7. FULL PO DETAILS
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

  // 8. ERROR
  else if (data?.error) {
    msg = data.error;
  }

  // 9. FINAL FALLBACK (should rarely happen now)
  else {
    msg = "No readable response from server";
  }

  if (!res.ok || data?.ok === false) {
    throw new Error(msg);
  }

  return {
    ok: true,
    reply: msg,
    data: data?.data ?? null,
    meta: data?.meta ?? null,
    raw: data,
  };
}