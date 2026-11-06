import { createFileRoute } from "@tanstack/react-router";
import { SessionView } from "@sapien/sessions";

export const Route = createFileRoute("/_shell/")({ component: SessionView });
