import { createFileRoute } from "@tanstack/react-router";
import { AgentSettings } from "@/modules/agent";

export const Route = createFileRoute("/settings/agent")({ component: AgentSettings });
