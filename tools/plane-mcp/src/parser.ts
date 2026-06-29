export interface ParsedFeature {
  name: string;
  id: string;
  description: string;
  tickets: ParsedTicket[];
}

export interface ParsedTicket {
  id: string;
  title: string;
  status: "Done" | "Backlog";
  isTest: boolean;
  isDevice: boolean;
  description: string;
  acceptanceCriteria: string[];
  blockedBy: string[];
  estimate: string;
  notes: string;
}

export interface ParsedEpic {
  name: string;
  features: ParsedFeature[];
}

export function parseTasksMd(content: string, epicName: string): ParsedEpic {
  const features: ParsedFeature[] = [];
  const lines = content.split("\n");

  let currentFeature: ParsedFeature | null = null;
  let currentTicket: ParsedTicket | null = null;
  let currentSection: "description" | "acceptance" | "notes" | "none" = "none";
  let descriptionLines: string[] = [];

  function flushTicket() {
    if (currentTicket && currentFeature) {
      if (descriptionLines.length > 0 && currentSection === "description") {
        currentTicket.description = descriptionLines.join("\n").trim();
      }
      currentFeature.tickets.push(currentTicket);
    }
    currentTicket = null;
    currentSection = "none";
    descriptionLines = [];
  }

  function flushFeature() {
    flushTicket();
    if (currentFeature) {
      features.push(currentFeature);
    }
    currentFeature = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Feature heading: "# Feature: Browse & Search (3xx)"
    const featureMatch = line.match(
      /^#\s+Feature:\s+(.+?)\s*\((\d+xx)\)\s*$/
    );
    if (featureMatch) {
      flushFeature();
      const featureName = featureMatch[1].trim();
      const featureId = featureMatch[2];
      // Grab the blockquote description that follows
      let desc = "";
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trim();
        if (next.startsWith(">")) {
          desc += (desc ? " " : "") + next.replace(/^>\s*/, "");
        } else if (next === "") {
          continue;
        } else {
          break;
        }
      }
      currentFeature = {
        name: featureName,
        id: featureId,
        description: desc,
        tickets: [],
      };
      continue;
    }

    // Ticket heading: "### API-101 — Title — **Done**" or "### API-903 — Title"
    const ticketMatch = line.match(
      /^###\s+([\w-]+)\s+—\s+(.+?)(?:\s+—\s+\*\*Done\*\*)?\s*$/
    );
    if (ticketMatch) {
      flushTicket();
      const id = ticketMatch[1];
      let title = ticketMatch[2].trim();
      const isDone = line.includes("**Done**");
      const isTest = title.includes("[TEST]");
      const isDevice = title.includes("[DEVICE]");
      title = title
        .replace(/\[TEST\]\s*/g, "")
        .replace(/\[DEVICE\]\s*/g, "")
        .trim();

      currentTicket = {
        id,
        title,
        status: isDone ? "Done" : "Backlog",
        isTest,
        isDevice,
        description: "",
        acceptanceCriteria: [],
        blockedBy: [],
        estimate: "",
        notes: "",
      };
      currentSection = "none";
      continue;
    }

    if (!currentTicket) continue;

    // Status line (for KRP tickets): "**Status:** Done"
    const statusMatch = line.match(/^\*\*Status:\*\*\s+(\w+)/);
    if (statusMatch) {
      currentTicket.status = statusMatch[1] === "Done" ? "Done" : "Backlog";
      continue;
    }

    // Description field
    if (line.startsWith("**Description:**")) {
      currentSection = "description";
      const inline = line.replace("**Description:**", "").trim();
      descriptionLines = inline ? [inline] : [];
      continue;
    }

    // Acceptance criteria
    if (line.startsWith("**Acceptance criteria:**")) {
      if (descriptionLines.length > 0 && currentSection === "description") {
        currentTicket.description = descriptionLines.join("\n").trim();
        descriptionLines = [];
      }
      currentSection = "acceptance";
      continue;
    }

    // Blocked by
    const blockedMatch = line.match(
      /^\*\*(?:Blocked by|Dependencies):\*\*\s+(.+)/
    );
    if (blockedMatch) {
      const deps = blockedMatch[1].trim();
      if (deps !== "none" && deps !== "none.") {
        currentTicket.blockedBy = deps
          .split(/[,;]/)
          .map((d) => d.trim())
          .filter(Boolean);
      }
      currentSection = "none";
      continue;
    }

    // Estimate
    const estMatch = line.match(/^\*\*Estimate:\*\*\s+(\w+)/);
    if (estMatch) {
      currentTicket.estimate = estMatch[1];
      currentSection = "none";
      continue;
    }

    // Notes
    if (line.startsWith("**Notes")) {
      currentSection = "notes";
      const inline = line.replace(/^\*\*Notes[^*]*\*\*:?\s*/, "").trim();
      if (inline) {
        currentTicket.notes =
          (currentTicket.notes ? currentTicket.notes + "\n" : "") + inline;
      }
      continue;
    }

    // Outcome (KRP)
    if (line.startsWith("**Outcome:**")) {
      currentSection = "notes";
      const inline = line.replace("**Outcome:**", "").trim();
      if (inline) {
        currentTicket.notes =
          (currentTicket.notes ? currentTicket.notes + "\n" : "") + inline;
      }
      continue;
    }

    // Continuation lines
    if (currentSection === "description" && line.trim() !== "") {
      descriptionLines.push(line.trim());
    } else if (currentSection === "acceptance" && line.match(/^-\s+/)) {
      currentTicket.acceptanceCriteria.push(
        line.replace(/^-\s+/, "").trim()
      );
    } else if (currentSection === "notes" && line.trim() !== "") {
      currentTicket.notes =
        (currentTicket.notes ? currentTicket.notes + "\n" : "") + line.trim();
    }
  }

  flushFeature();

  return { name: epicName, features };
}
