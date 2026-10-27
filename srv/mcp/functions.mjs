// REGISTRY OF ALLOWED RFC FUNCTIONS (read-only BAPIs called through the iFlow's RFC adapter).
//
// One entry = one MCP tool for the model. Nothing outside this list can be called.
// To allow another function: add an entry below, keep the iFlow allow-list in sync, redeploy CAP.
//
// Contract with the iFlow (op=function):
//   GET <gateway>?op=function&fn=<RFC NAME>&p=<URL-encoded JSON of the import parameters>
//   -> { "ok": true, "export": { "<EXPORT PARAMETER>": {...}, "RETURN": {...} } }
//   -> { "ok": false, "error": { "code": "...", "message": "..." } }
import { z } from "zod";

// SAP stores purely numeric material numbers with leading zeros (18 characters by default).
// RFC calls skip the screen conversion, so "10115130543" must be sent as "000000010115130543".
// Change the length with MATERIAL_PAD_LENGTH (e.g. 40) if your system uses long material numbers.
export function padMaterial(value) {
  const s = String(value ?? "").trim().toUpperCase();
  const len = Number(process.env.MATERIAL_PAD_LENGTH || 18);
  return /^\d+$/.test(s) && s.length < len ? s.padStart(len, "0") : s;
}

const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));

export const FUNCTIONS = [
  {
    tool: "get_material_detail",
    rfc: "BAPI_MATERIAL_GET_DETAIL",
    description:
      "Read the master data of ONE material by material number (description, type, group, units, plant data, valuation data). " +
      "Use it for questions about a specific material. Empty and zero fields are left out of the answer.",
    input: {
      material: z.string().describe("Material number as the user typed it, e.g. 10115130543. Leading zeros are added automatically."),
      plant: z.string().optional().describe("Optional plant, e.g. 2120, to include plant data."),
      valuationArea: z.string().optional().describe("Optional valuation area, to include valuation data."),
      valuationType: z.string().optional().describe("Optional valuation type."),
    },
    toRfc: ({ material, plant, valuationArea, valuationType }) =>
      defined({ MATERIAL: padMaterial(material), PLANT: plant, VALUATIONAREA: valuationArea, VALUATIONTYPE: valuationType }),
    exports: ["MATERIAL_GENERAL_DATA", "MATERIALPLANTDATA", "MATERIALVALUATIONDATA", "RETURN"],
    dropZeros: true,
    hint: "get_material_detail: master data of one material by number (RFC). Use query_entity_set for lists of documents instead.",
  },

  // ---- TEMPLATE for the next function (copy, rename, fill in) ----
  // {
  //   tool: "get_po_detail",
  //   rfc: "BAPI_PO_GETDETAIL1",
  //   description: "Read one purchase order with items by PO number.",
  //   input: { purchaseOrder: z.string().describe("PO number, e.g. 4000001836") },
  //   toRfc: ({ purchaseOrder }) => ({ PURCHASEORDER: purchaseOrder.padStart(10, "0") }),
  //   exports: ["POHEADER", "RETURN"],
  //   dropZeros: true,
  //   hint: "get_po_detail: one purchase order incl. header by PO number (RFC).",
  // },
];
