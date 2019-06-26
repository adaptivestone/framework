module.exports = [
    {
        transport:'winston-sentry-log',
        transportOptions:{
            dsn: "https://******@sentry.io/12345",
            level: "info"
        },
        logLevel: process.env.LOG_LEVEL || 'silly'
    },
    {
        transport:'console',
        transportOptions:{
            level: 'error',
            message: 'Public error to share'
        },
        logLevel: process.env.LOG_LEVEL || 'silly'
    }
];





