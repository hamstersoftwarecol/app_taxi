if (process.env.RAYO_MODE === "demo") await import("./demo-run.mjs");
else await import("./production/run.mjs");
