function splitNonEmptyLines(text = "") {
  return String(text)
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function isKeyValueLine(line) {
  return /.+:\s+.+/.test(line);
}

function parseKeyValue(text) {
  const lines = splitNonEmptyLines(text);
  const rows = [];

  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && value) rows.push({ Field: key, Value: value });
  }

  if (rows.length >= 2) {
    return { columns: ["Field", "Value"], rows };
  }
  return null;
}

function parsePipeTable(text) {
  try {
    const lines = splitNonEmptyLines(text);
    const pipeLines = lines.filter((l) => l.includes("|"));

    if (pipeLines.length < 2) return null;

    const firstLine = pipeLines[0];

    // ✅ detect if it's actual data (like "1) PO ...")
    const isDataRow = /^\d+\)\s*PO/.test(firstLine);

    let header;
    let dataLines;

    if (isDataRow) {
      header = ["PO", "Date", "By", "Vendor", "Cur", "Status"];
      dataLines = pipeLines; // ✅ keep ALL rows (fixes missing row 1)
    } else {
      header = firstLine.split("|").map((x) => x.trim()).filter(Boolean);
      dataLines = pipeLines.slice(1);
    }

    if (!header || header.length < 2) return null;

    const rows = dataLines.map((line) => {
      const cells = line.split("|").map((x) => x.trim());
      const row = {};

      header.forEach((h, i) => {
        let value = cells[i] || "";

        // ✅ safe cleanup
        if (i === 0) value = value.replace(/^\d+\)\s*/, "");
        if (value.includes("Date:")) value = value.replace("Date:", "").trim();
        if (value.includes("By:")) value = value.replace("By:", "").trim();
        if (value.includes("Vendor:")) value = value.replace("Vendor:", "").trim();
        if (value.includes("Cur:")) value = value.replace("Cur:", "").trim();
        if (value.includes("Status:")) value = value.replace("Status:", "").trim();

        row[h] = value;
      });

      return row;
    });

    return { columns: header, rows };
  } catch (e) {
    console.error("parsePipeTable error:", e);
    return null; // ✅ prevents white screen
  }
}

function parseBullets(text) {
  const lines = splitNonEmptyLines(text);
  const bullets = lines
    .filter(
      (l) =>
        l.startsWith("-") ||
        l.startsWith("•") ||
        l.startsWith("📋") ||
        l.startsWith("✅") ||
        l.startsWith("❌") ||
        l.startsWith("⚠️")
    )
    .map((l) => l.replace(/^[-•]\s*/, "").trim());

  if (bullets.length >= 2) {
    return { columns: ["Item"], rows: bullets.map((b) => ({ Item: b })) };
  }
  return null;
}

// ✅ IMPORTANT: named export (fixes your error)
export function replyToTable(replyText) {
  const text = String(replyText ?? "");

  // Prefer real tables first
  const pipe = parsePipeTable(text);
  if (pipe) return pipe;

  // Key: Value style (details)
  const kv = parseKeyValue(text);
  if (kv) return kv;

  // Bullets/help
  const bullets = parseBullets(text);
  if (bullets) return bullets;

  // Fallback: each line as a row
  const lines = splitNonEmptyLines(text);
  if (lines.length > 1) {
    return { columns: ["Output"], rows: lines.map((l) => ({ Output: l })) };
  }

  return { columns: ["Output"], rows: [{ Output: text.trim() || "-" }] };
}