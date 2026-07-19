import { generateText, type LanguageModel, type ModelMessage, stepCountIs, type ToolSet } from "ai";

export type HostedAgentMode = "plan" | "ask" | "auto";

export async function runHostedAgent(input: {
  effort: string;
  messages: ModelMessage[];
  mode: HostedAgentMode;
  model: LanguageModel;
  tools: ToolSet;
}) {
  const modeInstruction =
    input.mode === "plan"
      ? "You are in plan mode. Use only read-only tools and produce a concrete numbered plan."
      : input.mode === "ask"
        ? "You are in ask mode. Research freely, but explain proposed external changes before taking them."
        : "You are in auto mode. Complete safe requested work using the available tools.";

  return generateText({
    model: input.model,
    messages: input.messages,
    tools: input.tools,
    activeTools:
      input.mode === "plan"
        ? (Object.keys(input.tools).filter((name) => name.startsWith("search_")) as Array<
            keyof typeof input.tools
          >)
        : undefined,
    instructions: [
      "You are home's personal work assistant. Be direct, useful, and grounded in the user's connected data.",
      modeInstruction,
      `Reasoning effort requested: ${input.effort}.`,
    ].join("\n"),
    stopWhen: stepCountIs(8),
  });
}
