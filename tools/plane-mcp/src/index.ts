#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PlaneClient } from "./plane-client.js";
import { parseTasksMd } from "./parser.js";
import { readFileSync } from "fs";

const API_KEY = process.env.PLANE_API_KEY;
const WORKSPACE = process.env.PLANE_WORKSPACE_SLUG ?? "startni-dev";

if (!API_KEY) {
  console.error("PLANE_API_KEY environment variable is required");
  process.exit(1);
}

const client = new PlaneClient({ apiKey: API_KEY, workspaceSlug: WORKSPACE });
const server = new McpServer({
  name: "plane",
  version: "1.0.0",
});

// ─── Helpers ───

const ESTIMATE_MAP: Record<string, number> = { S: 1, M: 3, L: 5 };

function ticketToHtml(ticket: {
  description: string;
  acceptanceCriteria: string[];
  blockedBy: string[];
  estimate: string;
  notes: string;
  isTest: boolean;
  isDevice: boolean;
}): string {
  const parts: string[] = [];

  if (ticket.isTest) parts.push("<p><strong>Type:</strong> TEST</p>");
  if (ticket.isDevice) parts.push("<p><strong>Type:</strong> DEVICE</p>");

  if (ticket.description) {
    parts.push(`<p>${escapeHtml(ticket.description)}</p>`);
  }

  if (ticket.acceptanceCriteria.length > 0) {
    parts.push("<h3>Acceptance Criteria</h3><ul>");
    for (const ac of ticket.acceptanceCriteria) {
      parts.push(`<li>${escapeHtml(ac)}</li>`);
    }
    parts.push("</ul>");
  }

  if (ticket.blockedBy.length > 0) {
    parts.push(
      `<p><strong>Blocked by:</strong> ${ticket.blockedBy.map(escapeHtml).join(", ")}</p>`
    );
  }

  if (ticket.estimate) {
    parts.push(
      `<p><strong>Estimate:</strong> ${escapeHtml(ticket.estimate)}</p>`
    );
  }

  return parts.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function findOrCreateLabel(
  projectId: string,
  name: string,
  color: string
): Promise<string> {
  const { results } = await client.listLabels(projectId);
  const existing = results.find(
    (l) => l.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) return existing.id;
  const created = await client.createLabel(projectId, { name, color });
  return created.id;
}

async function getStateMap(
  projectId: string
): Promise<Record<string, string>> {
  const { results } = await client.listStates(projectId);
  const map: Record<string, string> = {};
  for (const s of results) {
    map[s.name.toLowerCase()] = s.id;
  }
  return map;
}

// ─── Tools ───

server.tool(
  "import_tasks",
  "Import tickets from a TASKS.md file into Plane. Creates the project (if needed), modules (epics), parent work items (features), and sub-issues (tasks). Run once per epic.",
  {
    tasks_file_path: z
      .string()
      .describe("Absolute path to the TASKS.md file to import"),
    epic_name: z
      .string()
      .describe('Name of the epic, e.g. "API" or "KOReader Plugin"'),
    project_id: z
      .string()
      .optional()
      .describe(
        "Plane project ID. If omitted, creates a new KoManga project."
      ),
  },
  async ({ tasks_file_path, epic_name, project_id }) => {
    const content = readFileSync(tasks_file_path, "utf-8");
    const epic = parseTasksMd(content, epic_name);

    // Ensure project
    let projId = project_id;
    if (!projId) {
      const { results } = await client.listProjects();
      const existing = results.find((p) => p.name === "KoManga");
      if (existing) {
        projId = existing.id;
      } else {
        const proj = await client.createProject({
          name: "KoManga",
          identifier: "KM",
          description:
            "Self-hosted manga reading system for Kobo e-readers",
          network: 0,
        });
        projId = proj.id;
      }
    }

    const states = await getStateMap(projId);
    const doneStateId = states["done"];
    const backlogStateId = states["backlog"];

    // Labels for ticket types
    const testLabelId = await findOrCreateLabel(projId, "TEST", "#f59e0b");
    const deviceLabelId = await findOrCreateLabel(
      projId,
      "DEVICE",
      "#8b5cf6"
    );

    // Estimate labels
    const estLabelIds: Record<string, string> = {};
    for (const [key, _] of Object.entries(ESTIMATE_MAP)) {
      estLabelIds[key] = await findOrCreateLabel(
        projId,
        `Est: ${key}`,
        "#6b7280"
      );
    }

    // Create module for this epic
    const { results: existingModules } = await client.listModules(projId);
    let mod = existingModules.find((m) => m.name === epic_name);
    if (!mod) {
      mod = await client.createModule(projId, {
        name: epic_name,
        description: `${epic_name} epic`,
      });
    }

    const allWorkItemIds: string[] = [];
    const idToWorkItemId: Record<string, string> = {};
    const summary: string[] = [];

    for (const feature of epic.features) {
      // Create parent work item for the feature
      const featureItem = await client.createWorkItem(projId, {
        name: `${feature.name} (${feature.id})`,
        description_html: feature.description
          ? `<p>${escapeHtml(feature.description)}</p>`
          : undefined,
        state: backlogStateId,
        priority: "none",
      });
      allWorkItemIds.push(featureItem.id);

      let featureDone = true;

      for (const ticket of feature.tickets) {
        const labels: string[] = [];
        if (ticket.isTest) labels.push(testLabelId);
        if (ticket.isDevice) labels.push(deviceLabelId);
        if (ticket.estimate && estLabelIds[ticket.estimate]) {
          labels.push(estLabelIds[ticket.estimate]);
        }

        const stateId =
          ticket.status === "Done" ? doneStateId : backlogStateId;
        if (ticket.status !== "Done") featureDone = false;

        const item = await client.createWorkItem(projId, {
          name: `${ticket.id} — ${ticket.title}`,
          description_html: ticketToHtml(ticket),
          state: stateId,
          priority: "none",
          label_ids: labels.length > 0 ? labels : undefined,
          parent: featureItem.id,
          external_id: ticket.id,
          external_source: "komanga-tasks",
        });

        idToWorkItemId[ticket.id] = item.id;
        allWorkItemIds.push(item.id);
      }

      // Mark the feature parent as done if all children are done
      if (featureDone && feature.tickets.length > 0) {
        await client.updateWorkItem(projId, featureItem.id, {
          state: doneStateId,
        });
      }

      summary.push(
        `  ${feature.name}: ${feature.tickets.length} tickets imported`
      );
    }

    // Add all work items to the module
    if (allWorkItemIds.length > 0) {
      await client.addWorkItemsToModule(projId, mod.id, allWorkItemIds);
    }

    const totalTickets = epic.features.reduce(
      (sum, f) => sum + f.tickets.length,
      0
    );

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Imported "${epic_name}" epic into project ${projId}:`,
            `  Module: ${mod.name} (${mod.id})`,
            `  Features: ${epic.features.length}`,
            `  Tickets: ${totalTickets}`,
            "",
            ...summary,
          ].join("\n"),
        },
      ],
    };
  }
);

server.tool(
  "create_work_item",
  "Create a new work item (issue) in the KoManga Plane project.",
  {
    project_id: z.string().describe("Plane project ID"),
    name: z.string().describe("Work item title"),
    description_html: z
      .string()
      .optional()
      .describe("HTML description of the work item"),
    state_name: z
      .string()
      .optional()
      .describe('State name, e.g. "Backlog", "Todo", "In Progress", "Done"'),
    priority: z
      .enum(["urgent", "high", "medium", "low", "none"])
      .optional()
      .describe("Priority level"),
    label_names: z
      .array(z.string())
      .optional()
      .describe("Label names to attach"),
    parent_id: z
      .string()
      .optional()
      .describe("Parent work item ID (makes this a sub-issue)"),
    module_id: z
      .string()
      .optional()
      .describe("Module ID to add this work item to"),
  },
  async ({
    project_id,
    name,
    description_html,
    state_name,
    priority,
    label_names,
    parent_id,
    module_id,
  }) => {
    let stateId: string | undefined;
    if (state_name) {
      const states = await getStateMap(project_id);
      stateId = states[state_name.toLowerCase()];
    }

    let labelIds: string[] | undefined;
    if (label_names && label_names.length > 0) {
      labelIds = [];
      for (const ln of label_names) {
        const id = await findOrCreateLabel(project_id, ln, "#6b7280");
        labelIds.push(id);
      }
    }

    const item = await client.createWorkItem(project_id, {
      name,
      description_html,
      state: stateId,
      priority: priority ?? "none",
      label_ids: labelIds,
      parent: parent_id,
    });

    if (module_id) {
      await client.addWorkItemsToModule(project_id, module_id, [item.id]);
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Created work item: ${item.name}\n  ID: ${item.id}\n  State: ${state_name ?? "default"}\n  Priority: ${priority ?? "none"}`,
        },
      ],
    };
  }
);

server.tool(
  "update_work_item",
  "Update an existing work item in Plane.",
  {
    project_id: z.string().describe("Plane project ID"),
    work_item_id: z.string().describe("Work item ID to update"),
    name: z.string().optional().describe("New title"),
    description_html: z.string().optional().describe("New HTML description"),
    state_name: z.string().optional().describe("New state name"),
    priority: z
      .enum(["urgent", "high", "medium", "low", "none"])
      .optional()
      .describe("New priority"),
    parent_id: z
      .string()
      .nullable()
      .optional()
      .describe("New parent ID, or null to remove parent"),
  },
  async ({
    project_id,
    work_item_id,
    name,
    description_html,
    state_name,
    priority,
    parent_id,
  }) => {
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (description_html !== undefined)
      updates.description_html = description_html;
    if (priority !== undefined) updates.priority = priority;
    if (parent_id !== undefined) updates.parent = parent_id;

    if (state_name) {
      const states = await getStateMap(project_id);
      const stateId = states[state_name.toLowerCase()];
      if (stateId) updates.state = stateId;
    }

    const item = await client.updateWorkItem(project_id, work_item_id, updates);

    return {
      content: [
        {
          type: "text" as const,
          text: `Updated work item: ${item.name}\n  ID: ${item.id}`,
        },
      ],
    };
  }
);

server.tool(
  "get_work_item",
  "Get details of a specific work item.",
  {
    project_id: z.string().describe("Plane project ID"),
    work_item_id: z.string().describe("Work item ID"),
  },
  async ({ project_id, work_item_id }) => {
    const item = await client.getWorkItem(project_id, work_item_id);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(item, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "list_work_items",
  "List work items in a project, with optional filters.",
  {
    project_id: z.string().describe("Plane project ID"),
    state_name: z.string().optional().describe("Filter by state name"),
    parent_id: z.string().optional().describe("Filter by parent work item ID"),
  },
  async ({ project_id, state_name, parent_id }) => {
    const params: Record<string, string> = {};
    if (state_name) {
      const states = await getStateMap(project_id);
      const stateId = states[state_name.toLowerCase()];
      if (stateId) params.state = stateId;
    }
    if (parent_id) {
      params.parent = parent_id;
    }

    const { results, total_results } = await client.listWorkItems(
      project_id,
      Object.keys(params).length > 0 ? params : undefined
    );

    const lines = results.map(
      (item) =>
        `- ${item.name} [${item.id}] priority=${item.priority} parent=${item.parent ?? "none"}`
    );

    return {
      content: [
        {
          type: "text" as const,
          text: `${total_results} work items:\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

server.tool(
  "list_modules",
  "List modules (epics) in a project.",
  {
    project_id: z.string().describe("Plane project ID"),
  },
  async ({ project_id }) => {
    const { results } = await client.listModules(project_id);
    const lines = results.map(
      (m) => `- ${m.name} [${m.id}] status=${m.status ?? "none"}`
    );
    return {
      content: [
        {
          type: "text" as const,
          text: `${results.length} modules:\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

server.tool(
  "list_projects",
  "List all projects in the workspace.",
  {},
  async () => {
    const { results } = await client.listProjects();
    const lines = results.map(
      (p) => `- ${p.name} [${p.id}] identifier=${p.identifier}`
    );
    return {
      content: [
        {
          type: "text" as const,
          text: `${results.length} projects:\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

server.tool(
  "create_module",
  "Create a new module (epic) in a project.",
  {
    project_id: z.string().describe("Plane project ID"),
    name: z.string().describe("Module name"),
    description: z.string().optional().describe("Module description"),
  },
  async ({ project_id, name, description }) => {
    const mod = await client.createModule(project_id, { name, description });
    return {
      content: [
        {
          type: "text" as const,
          text: `Created module: ${mod.name} [${mod.id}]`,
        },
      ],
    };
  }
);

// ─── Start ───

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
