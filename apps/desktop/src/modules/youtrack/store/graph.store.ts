import { createStore } from "@tanstack/react-store";

// Путь черновика, для которого открыто окно графа связей.
export const graphStore = createStore<string | null>(null);
