import { agents } from "./config/agents.js";
import { createToolRegistry } from "./config/tools.js";
import { Orchestrator } from "./control/orchestrator.js";
import { PolicyEngine } from "./control/policy-engine.js";
import { TaskRouter } from "./control/task-router.js";
import { EventLog } from "./events/event-log.js";
import { MessageBroker } from "./messages/message-broker.js";
import { LocalHarness } from "./runtime/local-harness.js";
import { ToolBroker } from "./tools/tool-broker.js";

const events = new EventLog();
const policy = new PolicyEngine();
const harness = new LocalHarness();
const registry = createToolRegistry();
const router = new TaskRouter(agents);
const toolBroker = new ToolBroker(policy, registry, events);
const messageBroker = new MessageBroker(policy, harness, events);
const orchestrator = new Orchestrator(agents, router, harness, toolBroker, messageBroker, events);

await orchestrator.run("Create the minimum Harmony control-plane architecture.");

for (const event of events.list()) {
  console.log(
    JSON.stringify(
      {
        type: event.type,
        actorId: event.actorId,
        targetId: event.targetId,
        data: event.data
      },
      null,
      2
    )
  );
}
