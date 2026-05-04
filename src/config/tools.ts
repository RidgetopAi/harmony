import type { DiscoveryRepository } from "../discovery/discovery-repository.js";
import { createDiscoveryScanRootTool } from "../discovery/file-discovery.js";
import { ToolRegistry } from "../tools/tool-registry.js";

export type ToolRegistryOptions = {
  discoveryRepository?: DiscoveryRepository;
};

export function createToolRegistry(options: ToolRegistryOptions = {}): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register("task.plan.create", (input) => ({
    ok: true,
    output: {
      created: true,
      plan: input
    }
  }));

  registry.register("workspace.note", (input) => ({
    ok: true,
    output: {
      saved: true,
      note: input
    }
  }));

  registry.register("filesystem.read", (input) => ({
    ok: true,
    output: {
      simulated: true,
      input
    }
  }));

  registry.register("discovery.scanRoot", createDiscoveryScanRootTool(options.discoveryRepository));

  registry.register("shell.exec", (input) => ({
    ok: true,
    output: {
      simulated: true,
      input
    }
  }));

  return registry;
}
