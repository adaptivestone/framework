class Base {
    constructor(app){
        this.app = app;
        this.logger = this.app.getConfig("log").get(this.constructor.loggerGroup+this.constructor.name);
        if (!this.logger.filters.length){
            this.logger.filters.push(this._loggerFilter.bind(this));
        }
    }

    _loggerFilter(level, msg, meta){
        return `(${process.pid}) \x1B[32m[${this.constructor.loggerGroup+this.constructor.name}]\x1B[39m ${msg}`;
    }
}

module.exports = Base;