module.exports = [
    {
        transport:'winston-sentry-log',
        transportOptions:{
            dsn: process.env.SENTRY_DSN,
            level: "info"
        },
        enable: process.env.ENABLE_LOGGER_SENTRY || false
    },
    {
        transport:'console',
        transportOptions:{
            level: 'error',
            message: 'Public error to share'
        },
        enable: true
    }
];





