import { serve } from "@hono/node-server";
import { createApp } from "#app/app";
import { readEnv } from "#core/config/env";

const env = readEnv();
const app = createApp(env);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`api слушает http://localhost:${info.port}`);
});
