import { createFileRoute } from "@tanstack/react-router";
import { SessionView } from "@/modules/agent";

export const Route = createFileRoute("/_shell/")({ component: SessionView });
