import { createApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";

const app = createApp();

const server = app.listen(config.PORT, () => {
  console.log(`DocMind API listening on http://localhost:${config.PORT}`);
});

// Graceful shutdown: finish in-flight requests and close DB connections
// when Docker (or Ctrl+C) asks the process to stop.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}
