# Contract between the MCP server and the iFlow ZMCP_Gateway for RFC (op=function)

The CAP project already sends this. The iFlow side is still to be built.

## Request

```
GET /http/zmcp/gateway?op=function&fn=BAPI_MATERIAL_GET_DETAIL&p=%7B%22MATERIAL%22%3A%22000000010115130543%22%7D
Authorization: Bearer <token>
```

- `fn`  RFC name, exactly as in srv/mcp/functions.mjs (field `rfc`).
- `p`   URL-encoded JSON object with the import parameters, e.g. {"MATERIAL":"000000010115130543","PLANT":"2120"}.
        Only parameters that were provided are present. The MCP server already pads numeric material numbers
        to 18 characters; the iFlow may pad too (padding twice does nothing).

## What the iFlow policy script must do (to build later)

1. Accept op=function only if `fn` is on its allow-list (same names as functions.mjs). No wildcards.
2. Refuse names with a write word (CREATE, CHANGE, POST, DELETE, UPDATE, SAVE, COMMIT, INSERT, MODIFY, CANCEL, REVERSE)
   and names that do not read like getters. Answer 403 {"ok":false,"error":{"code":"not_allowed",...}}.
3. Build the RFC request XML: root element = function name, in namespace urn:sap-com:document:sap:rfc:functions,
   one child element per key of `p` (validate keys against a per-function list of allowed import parameters).
4. RFC receiver with destination S4HANA_RFC (no confirm transaction, no commit).
5. Convert the RFC response XML to JSON and answer HTTP 200.

## Response

```json
{
  "ok": true,
  "function": "BAPI_MATERIAL_GET_DETAIL",
  "export": {
    "MATERIAL_GENERAL_DATA": { "MATL_DESC": "...", "...": "..." },
    "MATERIALPLANTDATA": { },
    "RETURN": { "TYPE": "S", "CODE": "", "MESSAGE": "" }
  }
}
```

Errors from the policy or from SAP being unreachable:

```json
{ "ok": false, "error": { "code": "not_allowed", "message": "Function is not on the allow-list." } }
```

SAP business errors (for example M3305, material does not exist) stay inside `export.RETURN` with TYPE "E".
The MCP server turns them into a clear message for the user, so the iFlow does not need to treat them as HTTP errors.
The MCP server also tolerates `data` instead of `export`, and RETURN as an object or a list.
