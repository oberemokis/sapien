import { createFileRoute } from "@tanstack/react-router";
import { AboutSettings } from "@/modules/updates";

export const Route = createFileRoute("/settings/about")({ component: AboutSettings });
