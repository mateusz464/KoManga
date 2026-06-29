const BASE_URL = "https://api.plane.so/api/v1";

export interface PlaneConfig {
  apiKey: string;
  workspaceSlug: string;
}

export interface Project {
  id: string;
  name: string;
  identifier: string;
  description?: string;
}

export interface State {
  id: string;
  name: string;
  group: "backlog" | "unstarted" | "started" | "completed" | "cancelled";
  default: boolean;
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Module {
  id: string;
  name: string;
  description?: string;
  status?: string;
}

export interface WorkItem {
  id: string;
  name: string;
  description_html?: string;
  state: string;
  priority: "urgent" | "high" | "medium" | "low" | "none";
  label_ids?: string[];
  parent?: string | null;
  sequence_id?: number;
  estimate_point?: number | null;
  external_id?: string | null;
  external_source?: string | null;
}

export interface CreateWorkItemInput {
  name: string;
  description_html?: string;
  state?: string;
  priority?: "urgent" | "high" | "medium" | "low" | "none";
  label_ids?: string[];
  parent?: string | null;
  estimate_point?: number | null;
  external_id?: string;
  external_source?: string;
}

export interface PaginatedResponse<T> {
  results: T[];
  total_results: number;
  next_page_results: boolean;
  next_cursor: string;
}

export class PlaneClient {
  private config: PlaneConfig;

  constructor(config: PlaneConfig) {
    this.config = config;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${BASE_URL}/workspaces/${this.config.workspaceSlug}${path}`;
    const headers: Record<string, string> = {
      "x-api-key": this.config.apiKey,
      "Content-Type": "application/json",
    };

    const maxRetries = 5;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 429 && attempt < maxRetries) {
        const delay = Math.min(1000 * 2 ** attempt, 30000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `Plane API ${method} ${path} → ${res.status}: ${text}`
        );
      }

      return res.json() as Promise<T>;
    }

    throw new Error(`Plane API ${method} ${path} → exhausted retries`);
  }

  // --- Projects ---

  async createProject(input: {
    name: string;
    identifier: string;
    description?: string;
    network?: number;
  }): Promise<Project> {
    return this.request<Project>("POST", "/projects/", {
      ...input,
      network: input.network ?? 0,
    });
  }

  async listProjects(): Promise<PaginatedResponse<Project>> {
    return this.request("GET", "/projects/");
  }

  async getProject(projectId: string): Promise<Project> {
    return this.request("GET", `/projects/${projectId}/`);
  }

  // --- States ---

  async listStates(
    projectId: string
  ): Promise<PaginatedResponse<State>> {
    return this.request("GET", `/projects/${projectId}/states/`);
  }

  async createState(
    projectId: string,
    input: { name: string; group: string; color?: string }
  ): Promise<State> {
    return this.request("POST", `/projects/${projectId}/states/`, input);
  }

  // --- Labels ---

  async listLabels(
    projectId: string
  ): Promise<PaginatedResponse<Label>> {
    return this.request("GET", `/projects/${projectId}/labels/`);
  }

  async createLabel(
    projectId: string,
    input: { name: string; color?: string }
  ): Promise<Label> {
    return this.request("POST", `/projects/${projectId}/labels/`, input);
  }

  // --- Modules ---

  async listModules(
    projectId: string
  ): Promise<PaginatedResponse<Module>> {
    return this.request("GET", `/projects/${projectId}/modules/`);
  }

  async createModule(
    projectId: string,
    input: { name: string; description?: string; status?: string }
  ): Promise<Module> {
    return this.request("POST", `/projects/${projectId}/modules/`, input);
  }

  async addWorkItemsToModule(
    projectId: string,
    moduleId: string,
    workItemIds: string[]
  ): Promise<void> {
    await this.request(
      "POST",
      `/projects/${projectId}/modules/${moduleId}/module-issues/`,
      { issues: workItemIds }
    );
  }

  // --- Work Items ---

  async listWorkItems(
    projectId: string,
    params?: Record<string, string>
  ): Promise<PaginatedResponse<WorkItem>> {
    const query = params
      ? "?" + new URLSearchParams(params).toString()
      : "";
    return this.request("GET", `/projects/${projectId}/work-items/${query}`);
  }

  async getWorkItem(
    projectId: string,
    workItemId: string
  ): Promise<WorkItem> {
    return this.request(
      "GET",
      `/projects/${projectId}/work-items/${workItemId}/`
    );
  }

  async createWorkItem(
    projectId: string,
    input: CreateWorkItemInput
  ): Promise<WorkItem> {
    return this.request("POST", `/projects/${projectId}/work-items/`, input);
  }

  async updateWorkItem(
    projectId: string,
    workItemId: string,
    input: Partial<CreateWorkItemInput>
  ): Promise<WorkItem> {
    return this.request(
      "PATCH",
      `/projects/${projectId}/work-items/${workItemId}/`,
      input
    );
  }

  async deleteWorkItem(
    projectId: string,
    workItemId: string
  ): Promise<void> {
    await this.request(
      "DELETE",
      `/projects/${projectId}/work-items/${workItemId}/`
    );
  }
}
