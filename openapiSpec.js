const SERVICE_ID = "department-api";
const VERSION = "1.0.0";

const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Department Management API",
    version: VERSION,
    description: "Manage departments, positions, and supervisor assignments across the organization.",
    "x-rizurf": {
      domain: "Human Resources",
      owner: "hr-team",
      app_url: "/",
      category: "Operations",
      industries: ["Human Resources", "Operations"],
      use_cases: [
        "Department management",
        "Supervisor assignments",
        "Directory lookups",
        "Organizational structure management"
      ],
      capabilities: [
        {
          name: "Manage Departments",
          icon: "🏢",
          description: "Create, list, update and delete departments",
          does: [
            "Create a department",
            "List all departments",
            "Fetch a single department",
            "Update a department",
            "Delete a department"
          ],
          best_for: "Applications managing company structure and teams",
          endpoints: [
            "GET /api/departments",
            "POST /api/departments",
            "GET /api/departments/{id}",
            "PUT /api/departments/{id}",
            "DELETE /api/departments/{id}"
          ]
        },
        {
          name: "Manage Supervisors",
          icon: "👤",
          description: "Manage supervisor directory and contact details",
          does: [
            "Create a supervisor",
            "List all supervisors",
            "Fetch a single supervisor",
            "Update a supervisor",
            "Delete a supervisor"
          ],
          best_for: "Applications managing leadership roles and personnel",
          endpoints: [
            "GET /api/supervisors",
            "POST /api/supervisors",
            "GET /api/supervisors/{id}",
            "PUT /api/supervisors/{id}",
            "DELETE /api/supervisors/{id}"
          ]
        }
      ],
      workflows: [
        {
          name: "Standard department creation flow",
          steps: ["POST /api/supervisors", "POST /api/departments", "GET /api/departments"]
        }
      ],
      related_services: []
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT"
      }
    }
  },
  paths: {
    "/health": {
      get: {
        summary: "Liveness and dependency check endpoint",
        "x-rizurf": {
          name: "Health Check",
          purpose: "Check service health and status",
          use_when: ["Checking liveness", "Monitoring service health"],
          do_not_use_when: [],
          inputs: [],
          outputs: ["status", "service", "version", "uptime_seconds", "checks"],
          requires: [],
          related_endpoints: ["GET /openapi.json"],
          tags: ["health", "status", "liveness"]
        }
      }
    },
    "/openapi.json": {
      get: {
        summary: "OpenAPI 3.0 specification document",
        "x-rizurf": {
          name: "OpenAPI Specification",
          purpose: "Retrieve OpenAPI specification document",
          use_when: ["Catalog discovery", "Gateway conformance checks"],
          do_not_use_when: [],
          inputs: [],
          outputs: ["openapi", "info", "paths", "components"],
          requires: [],
          related_endpoints: ["GET /health"],
          tags: ["openapi", "spec", "documentation"]
        }
      }
    },
    "/api/departments": {
      get: {
        summary: "List all departments",
        security: [{ bearerAuth: ["department:read"] }],
        "x-rizurf": {
          name: "List Departments",
          purpose: "Retrieve all departments",
          use_when: ["Displaying department directory", "Populating selection dropdowns"],
          do_not_use_when: ["Fetching a single department by ID"],
          inputs: ["search", "status"],
          outputs: ["id", "name", "supervisorId", "status"],
          requires: ["Authenticated caller"],
          related_endpoints: ["GET /api/departments/{id}", "POST /api/departments"],
          tags: ["department", "list", "directory"]
        }
      },
      post: {
        summary: "Create a new department",
        security: [{ bearerAuth: ["department:write"] }],
        "x-rizurf": {
          name: "Create Department",
          purpose: "Create a new department record",
          use_when: ["Adding a new department to the system"],
          do_not_use_when: ["Updating an existing department"],
          inputs: ["id", "name", "supervisorId", "status"],
          outputs: ["id", "name", "supervisorId", "status"],
          requires: ["Authenticated caller with write permissions"],
          related_endpoints: ["GET /api/departments", "PUT /api/departments/{id}"],
          tags: ["department", "create", "add"]
        }
      }
    },
    "/api/departments/{id}": {
      get: {
        summary: "Fetch one department by ID",
        security: [{ bearerAuth: ["department:read"] }],
        "x-rizurf": {
          name: "Get Department",
          purpose: "Fetch details of a single department",
          use_when: ["Viewing department profile"],
          do_not_use_when: ["Fetching all departments"],
          inputs: ["id"],
          outputs: ["id", "name", "supervisorId", "status"],
          requires: ["Department must exist"],
          related_endpoints: ["PUT /api/departments/{id}", "DELETE /api/departments/{id}"],
          tags: ["department", "fetch", "view"]
        }
      },
      put: {
        summary: "Update a department by ID",
        security: [{ bearerAuth: ["department:write"] }],
        "x-rizurf": {
          name: "Update Department",
          purpose: "Modify an existing department record",
          use_when: ["Changing department name or supervisor assignment"],
          do_not_use_when: ["Creating a new department"],
          inputs: ["id", "name", "supervisorId", "status"],
          outputs: ["id", "name", "supervisorId", "status"],
          requires: ["Department must exist"],
          related_endpoints: ["GET /api/departments/{id}", "DELETE /api/departments/{id}"],
          tags: ["department", "update", "edit"]
        }
      },
      delete: {
        summary: "Delete a department by ID",
        security: [{ bearerAuth: ["department:write"] }],
        "x-rizurf": {
          name: "Delete Department",
          purpose: "Remove a department record",
          use_when: ["Removing a department"],
          do_not_use_when: ["Deactivating a department without deleting"],
          inputs: ["id"],
          outputs: [],
          requires: ["Department must exist"],
          related_endpoints: ["GET /api/departments"],
          tags: ["department", "delete", "remove"]
        }
      }
    },
    "/api/supervisors": {
      get: {
        summary: "List all supervisors",
        security: [{ bearerAuth: ["supervisor:read"] }],
        "x-rizurf": {
          name: "List Supervisors",
          purpose: "Retrieve all supervisors",
          use_when: ["Displaying supervisor directory", "Selecting a supervisor for a department"],
          do_not_use_when: ["Fetching a single supervisor"],
          inputs: ["search", "status"],
          outputs: ["id", "firstName", "lastName", "email", "status"],
          requires: ["Authenticated caller"],
          related_endpoints: ["GET /api/supervisors/{id}", "POST /api/supervisors"],
          tags: ["supervisor", "list", "directory"]
        }
      },
      post: {
        summary: "Create a new supervisor",
        security: [{ bearerAuth: ["supervisor:write"] }],
        "x-rizurf": {
          name: "Create Supervisor",
          purpose: "Add a new supervisor to the system",
          use_when: ["Registering a new supervisor"],
          do_not_use_when: ["Updating an existing supervisor"],
          inputs: ["id", "firstName", "lastName", "email", "status"],
          outputs: ["id", "firstName", "lastName", "email", "status"],
          requires: ["Authenticated caller with write scope"],
          related_endpoints: ["GET /api/supervisors", "PUT /api/supervisors/{id}"],
          tags: ["supervisor", "create", "add"]
        }
      }
    },
    "/api/supervisors/{id}": {
      get: {
        summary: "Fetch one supervisor by ID",
        security: [{ bearerAuth: ["supervisor:read"] }],
        "x-rizurf": {
          name: "Get Supervisor",
          purpose: "Fetch details of a single supervisor",
          use_when: ["Viewing supervisor profile"],
          do_not_use_when: ["Fetching all supervisors"],
          inputs: ["id"],
          outputs: ["id", "firstName", "lastName", "email", "status"],
          requires: ["Supervisor must exist"],
          related_endpoints: ["PUT /api/supervisors/{id}", "DELETE /api/supervisors/{id}"],
          tags: ["supervisor", "fetch", "view"]
        }
      },
      put: {
        summary: "Update a supervisor by ID",
        security: [{ bearerAuth: ["supervisor:write"] }],
        "x-rizurf": {
          name: "Update Supervisor",
          purpose: "Modify an existing supervisor record",
          use_when: ["Updating supervisor contact details or name"],
          do_not_use_when: ["Creating a new supervisor"],
          inputs: ["id", "firstName", "lastName", "email", "status"],
          outputs: ["id", "firstName", "lastName", "email", "status"],
          requires: ["Supervisor must exist"],
          related_endpoints: ["GET /api/supervisors/{id}", "DELETE /api/supervisors/{id}"],
          tags: ["supervisor", "update", "edit"]
        }
      },
      delete: {
        summary: "Delete a supervisor by ID",
        security: [{ bearerAuth: ["supervisor:write"] }],
        "x-rizurf": {
          name: "Delete Supervisor",
          purpose: "Remove a supervisor record",
          use_when: ["Deleting a supervisor"],
          do_not_use_when: ["Reassigning a supervisor"],
          inputs: ["id"],
          outputs: [],
          requires: ["Supervisor must exist"],
          related_endpoints: ["GET /api/supervisors"],
          tags: ["supervisor", "delete", "remove"]
        }
      }
    }
  }
};

module.exports = {
  SERVICE_ID,
  VERSION,
  openapiSpec
};
