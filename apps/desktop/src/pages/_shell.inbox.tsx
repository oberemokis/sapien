import { createFileRoute } from "@tanstack/react-router";
import { Inbox } from "@/modules/forge";

export const Route = createFileRoute("/_shell/inbox")({ component: Inbox });
