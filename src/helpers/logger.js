const levels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];

const consoleLogger = (level, message) => {
  if (
    !process.env.LOGGER_CONSOLE_LEVEL ||
    levels.indexOf(process.env.LOGGER_CONSOLE_LEVEL) >= levels.indexOf(level)
  ) {
    if (console[level]) {
      console[level](message);
    } else {
      console.log(message);
    }
  }
};

export { levels, consoleLogger };
