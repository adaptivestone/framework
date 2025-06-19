const levels = ['error', 'warn', 'info', 'debug'] as const;

type LogLevel = (typeof levels)[number];

function isLogLevel(level?: string): level is LogLevel {
  return (
    typeof level === 'string' &&
    (levels as ReadonlyArray<string>).includes(level)
  );
}

const consoleLogger = (level: LogLevel, message: string) => {
  const configuredLevelIndex = isLogLevel(level) ? levels.indexOf(level) : -1;
  const currentLevelIndex = levels.indexOf(level);
  const shouldLog =
    configuredLevelIndex === -1 || configuredLevelIndex >= currentLevelIndex;
  if (shouldLog) {
    if (console[level]) {
      console[level](message);
    } else {
      console.log(message);
    }
  }
};

export { levels, consoleLogger };
