import { pino } from "pino";

export type Logger = pino.Logger;

export function createLogger(level: string): Logger {
  return pino({
    level,
    // Never write these to the log, even by accident.
    redact: [
      "req.headers.cookie",
      "req.headers.authorization",
      "password",
      "*.password",
      "*.passwordHash",
    ],
  });
}
