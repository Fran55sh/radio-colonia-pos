import { spawn } from "node:child_process";

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

async function main() {
  console.log("Ejecutando migraciones POS (tablas pos_*)...");
  await run("node", ["dist/db/migrate.js"]);

  const nodeEnv = process.env.NODE_ENV ?? "development";
  const seedDemo = process.env.POS_SEED_DEMO === "true";
  if (nodeEnv !== "production" || seedDemo) {
    console.log("Seed POS (sin catálogo dummy)...");
    await run("node", ["dist/db/seed.js"]);
  } else {
    console.log("Seed omitido en producción.");
  }

  console.log("Iniciando API...");
  const args = process.argv.slice(2);
  const cmd = args[0] ?? "node";
  const cmdArgs = args.length > 0 ? args.slice(1) : ["dist/index.js"];

  const child = spawn(cmd, cmdArgs, { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
