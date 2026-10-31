import { createFileRoute } from "@tanstack/react-router";
import { VaultSettings } from "@/modules/vault";

export const Route = createFileRoute("/settings/vault")({ component: VaultSettings });
