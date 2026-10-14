type Level = "debug" | "info" | "warn" | "error";

export interface Logger {
  log(level: Level, msg: string, fields?: Record<string, unknown>): void;
}

/** Structured JSON logs, one line per event, ready for Cloud Logging or any log shipper. */
export const jsonLogger: Logger = {
  log(level, msg, fields = {}) {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
    (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
  },
};

export const silentLogger: Logger = { log() {} };
