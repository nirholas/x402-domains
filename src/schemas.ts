// GENERATED from openapi.json — do not edit by hand.
//
// Per-route invocation contracts published inside the x402 402 challenge as
// `accepts[].outputSchema`. `input` tells an agent how to build the request
// (method, query/path params, JSON body fields); `output` is the JSON Schema of
// the 200 body it gets back once payment settles.
//
// Deriving these from `openapi.json` keeps the runtime challenge — which the
// x402scan discovery spec treats as authoritative — from ever contradicting the
// published spec. Regenerate whenever a paid route's parameters or response
// schema change.
//
// Keys match the paywall route map in `server.ts` exactly (`"<METHOD> <path>"`,
// with `:param` for path segments).

import type { RouteSchema } from "./payments.js";

export const ROUTE_SCHEMAS: Record<string, RouteSchema> = {
  "GET /check/:domain": {
    "input": {
      "type": "http",
      "method": "GET",
      "queryParams": {},
      "pathParams": {
        "domain": {
          "type": "string",
          "examples": [
            "example.com"
          ],
          "description": "Registrable domain name. IDNs must be punycode.",
          "x-required": true
        }
      }
    },
    "output": {
      "type": "object",
      "required": [
        "domain",
        "status",
        "available",
        "source",
        "checkedAt"
      ],
      "properties": {
        "domain": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "enum": [
            "registered",
            "available",
            "unknown"
          ]
        },
        "available": {
          "type": [
            "boolean",
            "null"
          ],
          "description": "true = no registration found; false = registered; null = undetermined."
        },
        "registrar": {
          "type": [
            "string",
            "null"
          ]
        },
        "registrarIanaId": {
          "type": [
            "string",
            "null"
          ]
        },
        "createdAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "updatedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "expiresAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "nameservers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "statusFlags": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "dnssecSigned": {
          "type": [
            "boolean",
            "null"
          ]
        },
        "rdapServer": {
          "type": [
            "string",
            "null"
          ]
        },
        "source": {
          "type": "string",
          "enum": [
            "rdap"
          ]
        },
        "note": {
          "type": "string"
        },
        "checkedAt": {
          "type": "string",
          "format": "date-time"
        }
      }
    }
  },
  "POST /bulk": {
    "input": {
      "type": "http",
      "method": "POST",
      "bodyType": "json",
      "bodyFields": {
        "domains": {
          "type": "array",
          "minItems": 1,
          "maxItems": 50,
          "items": {
            "type": "string"
          },
          "x-required": true
        }
      }
    },
    "output": {
      "type": "object",
      "required": [
        "count",
        "results",
        "checkedAt"
      ],
      "properties": {
        "count": {
          "type": "integer"
        },
        "registered": {
          "type": "integer"
        },
        "available": {
          "type": "integer"
        },
        "unknown": {
          "type": "integer"
        },
        "results": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "domain",
              "status",
              "available",
              "source",
              "checkedAt"
            ],
            "properties": {
              "domain": {
                "type": "string"
              },
              "status": {
                "type": "string",
                "enum": [
                  "registered",
                  "available",
                  "unknown"
                ]
              },
              "available": {
                "type": [
                  "boolean",
                  "null"
                ],
                "description": "true = no registration found; false = registered; null = undetermined."
              },
              "registrar": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "registrarIanaId": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "createdAt": {
                "type": [
                  "string",
                  "null"
                ],
                "format": "date-time"
              },
              "updatedAt": {
                "type": [
                  "string",
                  "null"
                ],
                "format": "date-time"
              },
              "expiresAt": {
                "type": [
                  "string",
                  "null"
                ],
                "format": "date-time"
              },
              "nameservers": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "statusFlags": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "dnssecSigned": {
                "type": [
                  "boolean",
                  "null"
                ]
              },
              "rdapServer": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "source": {
                "type": "string",
                "enum": [
                  "rdap"
                ]
              },
              "note": {
                "type": "string"
              },
              "checkedAt": {
                "type": "string",
                "format": "date-time"
              }
            }
          }
        },
        "checkedAt": {
          "type": "string",
          "format": "date-time"
        }
      }
    }
  },
};
