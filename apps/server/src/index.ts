import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { Elysia } from "elysia";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { authRoutes } from "./routes/auth.ts";
import { dayRoutes } from "./routes/days.ts";
import { youRoutes } from "./routes/you.ts";

const port = Number(process.env.PORT ?? 3000);
const webDist = join(import.meta.dir, "../../web/dist");

const app = new Elysia()
  .use(
    cors({
      origin: true,
      credentials: true,
    }),
  )
  .get("/api/health", () => ({
    ok: true,
    service: "eaj",
    apiVersion: 4,
  }))
  .use(authRoutes)
  .use(dayRoutes)
  .use(youRoutes);

if (existsSync(webDist)) {
  const indexHtml = () => Bun.file(join(webDist, "index.html"));
  // Handle "/" and client routes because @elysiajs/static indexHTML misses them in production.
  for (const path of ["/", "/auth", "/onboarding", "/dashboard", "/you", "/settings"]) {
    app.get(path, indexHtml);
  }
  // Public share pages are dynamic client routes.
  app.get("/share/:token", indexHtml);
  app.use(
    staticPlugin({
      assets: webDist,
      prefix: "/",
      indexHTML: true,
    }),
  );
} else {
  app.get("/", () => ({
    message:
      "EAJ API is running. Build the web app (bun run build) or use the Vite dev server for the UI.",
  }));
}

app.listen(port);
console.log(`EAJ listening on http://localhost:${port}`);

export type App = typeof app;
