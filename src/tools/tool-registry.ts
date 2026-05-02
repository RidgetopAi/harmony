export type ToolResult = {
  ok: boolean;
  output: unknown;
};

export type ToolHandler = (input: unknown) => Promise<ToolResult> | ToolResult;

export class ToolRegistry {
  private readonly handlers = new Map<string, ToolHandler>();

  register(name: string, handler: ToolHandler): void {
    this.handlers.set(name, handler);
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  async execute(name: string, input: unknown): Promise<ToolResult> {
    const handler = this.handlers.get(name);

    if (!handler) {
      return {
        ok: false,
        output: `Tool is not registered: ${name}`
      };
    }

    return handler(input);
  }
}
