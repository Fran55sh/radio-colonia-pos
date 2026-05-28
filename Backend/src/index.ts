import { startServer } from "./app.js";

startServer().catch((err) => {
  console.error("No se pudo iniciar el servidor:", err);
  process.exit(1);
});
