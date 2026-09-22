import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Model files are tens of MB and content-stable — serve them immutable in
// dev/preview too (production gets the same from vercel.json). This sits
// UNDER transformers.js's Cache API layer ('transformers-cache'), which only
// works in secure contexts (localhost/HTTPS); over plain-HTTP LAN the HTTP
// cache is the only thing preventing a re-download per visit.
function modelCacheHeaders(req, res, next) {
  if (req.url?.startsWith("/models/")) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
  next();
}

const cacheModels = {
  name: "cache-models-immutable",
  configureServer(server) {
    server.middlewares.use(modelCacheHeaders);
  },
  configurePreviewServer(server) {
    server.middlewares.use(modelCacheHeaders);
  },
};

export default defineConfig({
  plugins: [react(), cacheModels],
  server: {
    port: 5173,
    open: true,
  },
});
