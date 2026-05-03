import type { AgentDefinition } from "../agents/agent-definition.js";
import { AGENT_PROTOCOL_INSTRUCTIONS } from "../protocol/agent-protocol.js";

export const agents: AgentDefinition[] = [
  {
    id: "planner",
    name: "Planner",
    role: "Breaks tasks into controlled work and delegates to specialist agents.",
    systemPrompt: [
      "You plan work and request help through Harmony. You do not execute commands directly.",
      AGENT_PROTOCOL_INSTRUCTIONS
    ].join(" "),
    model: {
      provider: "local-stub",
      model: "planner-stub"
    },
    allowedTools: ["task.plan.create"],
    canTalkTo: ["coder", "reviewer"],
    permissions: {
      canReadFiles: false,
      canWriteFiles: false,
      canRunCommands: false,
      requiresApprovalFor: ["shell.exec", "filesystem.write"]
    }
  },
  {
    id: "coder",
    name: "Coder",
    role: "Designs and implements bounded code changes.",
    systemPrompt: [
      "You produce implementation notes and request tools through Harmony.",
      AGENT_PROTOCOL_INSTRUCTIONS
    ].join(" "),
    model: {
      provider: "local-stub",
      model: "coder-stub"
    },
    allowedTools: ["workspace.note", "filesystem.read"],
    canTalkTo: ["reviewer"],
    permissions: {
      canReadFiles: true,
      canWriteFiles: false,
      canRunCommands: false,
      requiresApprovalFor: ["filesystem.write", "shell.exec"]
    }
  },
  {
    id: "file-discovery-agent",
    name: "File Discovery Agent",
    role: "Scans approved local source roots and reports discovered file metadata.",
    systemPrompt: [
      "You discover files only by requesting scoped discovery tools through Harmony.",
      AGENT_PROTOCOL_INSTRUCTIONS
    ].join(" "),
    model: {
      provider: "local-stub",
      model: "file-discovery-stub"
    },
    allowedTools: ["discovery.scanRoot"],
    canTalkTo: ["planner", "reviewer"],
    permissions: {
      canReadFiles: true,
      canWriteFiles: false,
      canRunCommands: false,
      requiresApprovalFor: ["filesystem.write", "shell.exec"]
    }
  },
  {
    id: "reviewer",
    name: "Reviewer",
    role: "Reviews plans and outputs for risk.",
    systemPrompt: [
      "You review work and cannot edit files.",
      AGENT_PROTOCOL_INSTRUCTIONS
    ].join(" "),
    model: {
      provider: "local-stub",
      model: "reviewer-stub"
    },
    allowedTools: ["filesystem.read"],
    canTalkTo: ["planner", "coder"],
    permissions: {
      canReadFiles: true,
      canWriteFiles: false,
      canRunCommands: false,
      requiresApprovalFor: []
    }
  }
];
