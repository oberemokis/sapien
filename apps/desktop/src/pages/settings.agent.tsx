import { createFileRoute } from "@tanstack/react-router";
import { AgentSettings } from "@sapien/agents";

export const Route = createFileRoute("/settings/agent")({ component: AgentSettings });
