export function formatOneLine({ entity, intent, id, data, intentDef }) {
  if (typeof intentDef?.template === "function") {
    return intentDef.template({ entity, intent, id, data });
  }

  // default generic one-liner
  const keys = Object.keys(data || {});
  const firstKey = keys[0];
  return `${entity} ${id} ${intent}: ${firstKey ? data[firstKey] : "N/A"}`;
}