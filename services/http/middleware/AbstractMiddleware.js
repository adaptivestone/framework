"use strict";

const Base = require('../../../modules/Base');

class AbstractMiddleware extends Base {
    getMiddleware(){
        return this.middleware.bind(this);
    }

    static get loggerGroup(){
        return 'middleware'
    }
}

module.exports = AbstractMiddleware;