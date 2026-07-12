type Level = "debug" | "info" | "warn" | "error";

function write(level: Level, scope: string, msg: string, extra?: Record<string, unknown>) {
  const line = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg,
    ...(extra ?? {}),
  };
  const out = JSON.stringify(line);
  if (level === "error") console.error(out);
  else console.log(out);
}

export function logger(scope: string) {
  return {
    debug: (msg: string, extra?: Record<string, unknown>) => write("debug", scope, msg, extra),
    info: (msg: string, extra?: Record<string, unknown>) => write("info", scope, msg, extra),
    warn: (msg: string, extra?: Record<string, unknown>) => write("warn", scope, msg, extra),
    error: (msg: string, extra?: Record<string, unknown>) => write("error", scope, msg, extra),
  };
}

export type Logger = ReturnType<typeof logger>;
