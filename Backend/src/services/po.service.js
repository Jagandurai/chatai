import { ApiError } from "../utils/errors.js";
import { getEntityEndpoint } from "../sap/endpoints.js";
import { sapGetXml } from "../sap/sapClient.js";

function encodeODataString(val) {
  return String(val).replace(/'/g, "''");
}

function buildDateFilter(filters) {
  const from = filters?.docDateFrom;
  const to = filters?.docDateTo;
  if (!from || !to) return null;

  const fromExpr = `datetime'${from}T00:00:00'`;
  const toExpr = `datetime'${to}T23:59:59'`;
  return `(PoDocDate ge ${fromExpr} and PoDocDate le ${toExpr})`;
}

export const poService = {
  async fetch({ id, intent, filters }) {
    const entitySet = getEntityEndpoint("PO");
    if (!entitySet) throw new ApiError(500, "PO_ENTITYSET not configured.");

    // LIST mode
    if (intent === "SHOW_PO") {
      const configuredTop = Number(process.env.PO_LIST_TOP || 200);

      const skip = Math.max(0, Number(filters?.skip || 0));
      const limit = Math.max(1, Number(filters?.limit || process.env.PO_LIST_TAKE || 20));

      // We must fetch enough records so the transformer can build headers and then slice.
      // If your OData supports $skip, we can page at SAP side too.
      // Some services may ignore $skip; in that case, you'll still get consistent behavior due to local slicing,
      // but the dataset might be limited by $top.
      const top = Math.max(limit, configuredTop);

      const dateFilter = buildDateFilter(filters);
      const extraFilterParts = [];

      if (filters?.createdBy) extraFilterParts.push(`UserCreated eq '${encodeODataString(filters.createdBy)}'`);
      if (filters?.vendorId) extraFilterParts.push(`SuppAcoutNo eq '${encodeODataString(filters.vendorId)}'`);
      if (filters?.status) extraFilterParts.push(`Status eq '${encodeODataString(filters.status)}'`);
      if (dateFilter) extraFilterParts.push(dateFilter);

      const filterQuery = extraFilterParts.length
        ? `&$filter=${encodeURIComponent(extraFilterParts.join(" and "))}`
        : "";

      // Add $skip for paging
      const skipQuery = skip ? `&$skip=${skip}` : "";

      const qs = `?$top=${top}${skipQuery}&$orderby=PoDocDate desc${filterQuery}`;

      try {
        return await sapGetXml(`${entitySet}${qs}`);
      } catch (e) {
        const msg = String(e?.message || "");
        const status = e?.status || e?.statusCode;

        const shouldFallback = status === 400 || msg.includes("SAP GET failed (400)");
        if (!shouldFallback) throw e;

        // fallback without filters (but keep skip if SAP supports it)
        const qsFallback = `?$top=${top}${skipQuery}&$orderby=PoDocDate desc`;
        return sapGetXml(`${entitySet}${qsFallback}`);
      }
    }

    // DETAILS by PO number
    const filter = `$filter=PoNo eq '${encodeODataString(id)}'`;
    const qs = `?$format=xml&${filter}`;
    return sapGetXml(`${entitySet}${qs}`);
  },
};