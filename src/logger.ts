import pino from "pino";

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

const logger = pino({
  level: LOG_LEVEL,
  base: undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export default logger;
