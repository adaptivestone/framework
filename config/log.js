module.exports = [
    {
        transport:'winston-sentry-log',
        transportOptions:{
            dsn: "https://******@sentry.io/12345",
            level: "info"
        },
        enable: process.env.ENABLE_LOGGER_SENTRY || true
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





