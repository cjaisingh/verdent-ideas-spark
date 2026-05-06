// OpenAPI 3.1 spec for the AWIP Core contract API (single edge function `awip-api`).
// Kept in TS so the Swagger UI page stays a pure client-side import.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "https://<project-ref>.supabase.co";

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "AWIP Core API",
    version: "1.0.0",
    description:
      "Contract API exposed by the AWIP Core edge function `awip-api`. " +
      "Every endpoint requires either an operator JWT (`Authorization: Bearer …`) " +
      "or the cross-project service token (`x-awip-service-token: …`).",
  },
  servers: [
    {
      url: `${SUPABASE_URL}/functions/v1/awip-api`,
      description: "This project's deployed edge function",
    },
  ],
  tags: [
    { name: "capabilities", description: "Capability manifest + demand" },
    { name: "okr", description: "OKR tree ingest, spawn, supersede, read" },
    { name: "events", description: "Merged event stream" },
  ],
  components: {
    securitySchemes: {
      operatorJwt: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Supabase access token of an operator/admin user.",
      },
      serviceToken: {
        type: "apiKey",
        in: "header",
        name: "x-awip-service-token",
        description: "Cross-project service token (`AWIP_SERVICE_TOKEN`).",
      },
    },
    parameters: {
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: false,
        schema: { type: "string" },
        description:
          "Replays with the same key return the original response. Honoured by `POST /okr/ingest`.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: { error: { type: "string" } },
        required: ["error"],
      },
      CapabilityStatus: {
        type: "string",
        enum: ["available", "planned", "experimental", "unknown"],
      },
      Capability: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string", nullable: true },
          status: { $ref: "#/components/schemas/CapabilityStatus" },
          version: { type: "string" },
          inputs_required: { type: "array", items: { type: "object" } },
          outputs_provided: { type: "array", items: { type: "object" } },
          owning_module: { type: "string", nullable: true },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
        required: ["id", "name", "status", "version"],
      },
      Measurement: {
        type: "object",
        properties: {
          metric_name: { type: "string" },
          baseline: { type: "number", nullable: true },
          target: { type: "number", nullable: true },
          unit: { type: "string", nullable: true },
          cadence: { type: "string", nullable: true },
          attribution_rules: { type: "object" },
          data_sources: { type: "array", items: { type: "object" } },
          required_capabilities: { type: "array", items: { type: "string" } },
        },
        required: ["metric_name"],
      },
      OkrNode: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          tenant_id: { type: "string", format: "uuid" },
          parent_id: { type: "string", format: "uuid", nullable: true },
          kind: { type: "string", enum: ["objective", "key_result"] },
          title: { type: "string" },
          description: { type: "string", nullable: true },
          status: {
            type: "string",
            enum: ["draft", "active", "superseded", "achieved", "abandoned"],
          },
          version: { type: "integer" },
          superseded_by: { type: "string", format: "uuid", nullable: true },
          spawned_from_reason: { type: "string", nullable: true },
          created_by: { type: "string", enum: ["discovery_ai", "awip", "human"] },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
          okr_measurements: {
            type: "array",
            items: { $ref: "#/components/schemas/Measurement" },
          },
        },
      },
      IngestNode: {
        type: "object",
        properties: {
          client_id: { type: "string" },
          parent_client_id: { type: "string", nullable: true },
          kind: { type: "string", enum: ["objective", "key_result"] },
          title: { type: "string" },
          description: { type: "string", nullable: true },
          measurement: { $ref: "#/components/schemas/Measurement" },
        },
        required: ["client_id", "kind", "title"],
      },
      Event: {
        type: "object",
        properties: {
          id: { type: "string" },
          source: { type: "string", enum: ["okr", "capability"] },
          ref: { type: "string" },
          tenant_id: { type: "string", format: "uuid", nullable: true },
          event_type: { type: "string" },
          payload: { type: "object" },
          actor: { type: "string", nullable: true },
          created_at: { type: "string", format: "date-time" },
        },
      },
      DemandRow: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          status: { $ref: "#/components/schemas/CapabilityStatus" },
          owning_module: { type: "string", nullable: true },
          tenant_ids: { type: "array", items: { type: "string", format: "uuid" } },
          tenant_count: { type: "integer" },
          kr_count: { type: "integer" },
          active_kr_count: { type: "integer" },
        },
      },
      Tenant: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          slug: { type: "string" },
          name: { type: "string" },
        },
      },
    },
  },
  security: [{ operatorJwt: [] }, { serviceToken: [] }],
  paths: {
    "/capabilities": {
      get: {
        tags: ["capabilities"],
        summary: "List capability manifest",
        parameters: [
          {
            name: "status",
            in: "query",
            required: false,
            schema: { $ref: "#/components/schemas/CapabilityStatus" },
          },
        ],
        responses: {
          "200": {
            description: "Capability list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    capabilities: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Capability" },
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/schemas/Error" as never },
        },
      },
    },
    "/capabilities/register": {
      post: {
        tags: ["capabilities"],
        summary: "Upsert a capability and emit a `registered` event",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["id", "name", "status"],
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  description: { type: "string" },
                  status: { $ref: "#/components/schemas/CapabilityStatus" },
                  version: { type: "string" },
                  inputs_required: { type: "array", items: { type: "object" } },
                  outputs_provided: { type: "array", items: { type: "object" } },
                  owning_module: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Registered",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    id: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/okr/ingest": {
      post: {
        tags: ["okr"],
        summary: "Ingest a draft OKR tree (idempotent)",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["tenant_slug", "nodes"],
                properties: {
                  tenant_slug: { type: "string" },
                  tenant_name: { type: "string" },
                  nodes: {
                    type: "array",
                    items: { $ref: "#/components/schemas/IngestNode" },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Ingest result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    tenant_id: { type: "string", format: "uuid" },
                    created: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          client_id: { type: "string" },
                          id: { type: "string", format: "uuid" },
                        },
                      },
                    },
                    warnings: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/okr/{id}/spawn": {
      post: {
        tags: ["okr"],
        summary: "Spawn a sub-OKR under an existing node",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["kind", "title", "spawned_from_reason"],
                properties: {
                  kind: { type: "string", enum: ["objective", "key_result"] },
                  title: { type: "string" },
                  description: { type: "string" },
                  spawned_from_reason: { type: "string" },
                  created_by: { type: "string", enum: ["discovery_ai", "awip", "human"] },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "New node",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    node: { $ref: "#/components/schemas/OkrNode" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/okr/{id}/supersede": {
      post: {
        tags: ["okr"],
        summary: "Replace a node with a v+1 successor",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title", "reason"],
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  reason: { type: "string" },
                  created_by: { type: "string", enum: ["discovery_ai", "awip", "human"] },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Successor node",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    node: { $ref: "#/components/schemas/OkrNode" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/okr/tree": {
      get: {
        tags: ["okr"],
        summary: "Full OKR tree for a tenant (incl. superseded)",
        parameters: [
          { name: "tenant_id", in: "query", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Nodes",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    nodes: { type: "array", items: { $ref: "#/components/schemas/OkrNode" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/events/recent": {
      get: {
        tags: ["events"],
        summary: "Merged OKR + capability event stream (newest first)",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 100, maximum: 500 } },
          { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "tenant_id", in: "query", schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Events",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    count: { type: "integer" },
                    events: { type: "array", items: { $ref: "#/components/schemas/Event" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/capabilities/demand": {
      get: {
        tags: ["capabilities"],
        summary: "Capability demand aggregate (ranked)",
        responses: {
          "200": {
            description: "Demand rows + tenants",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    demand: { type: "array", items: { $ref: "#/components/schemas/DemandRow" } },
                    tenants: { type: "array", items: { $ref: "#/components/schemas/Tenant" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/capabilities/{id}/demand-detail": {
      get: {
        tags: ["capabilities"],
        summary: "Per-capability drill-down: tenants + KRs driving demand",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Capability + tenants + KRs",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    capability: { $ref: "#/components/schemas/Capability" },
                    tenants: {
                      type: "array",
                      items: {
                        allOf: [
                          { $ref: "#/components/schemas/Tenant" },
                          {
                            type: "object",
                            properties: {
                              kr_count: { type: "integer" },
                              active_kr_count: { type: "integer" },
                            },
                          },
                        ],
                      },
                    },
                    krs: { type: "array", items: { $ref: "#/components/schemas/OkrNode" } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
