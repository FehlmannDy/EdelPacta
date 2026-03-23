import pino from "pino";

const VALID_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"];
const rawLevel = process.env.LOG_LEVEL ?? "info";
const level = VALID_LEVELS.includes(rawLevel) ? rawLevel : "info";

const logger = pino({
  level,
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" } }
      : undefined,
});

export default logger;
