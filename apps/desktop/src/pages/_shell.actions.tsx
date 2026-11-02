import { createFileRoute } from "@tanstack/react-router";
import { ActionsView } from "@/modules/agent";

export const Route = createFileRoute("/_shell/actions")({ component: ActionsView });
