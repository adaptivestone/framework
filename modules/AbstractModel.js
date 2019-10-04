const mongoose = require('mongoose');
const Base = require('./Base');

class AbstractModel extends Base{
    constructor(app){
        super(app);
        this.mongooseSchema = mongoose.Schema(this.modelSchema);
        this.mongooseSchema.set("timestamps",true);
        this.mongooseSchema.set("minimize",false);
        this.mongooseSchema.loadClass(this.constructor);
        this.mongooseSchema.statics.getSuper = ()=>this;
        this.initHooks();
        this.mongooseModel = mongoose.model(this.constructor.name, this.mongooseSchema);
        if (!mongoose.connection.readyState){//do not connect on test
            mongoose.connect(
                this.app.getConfig("mongo").connectionString,
                {
                    useNewUrlParser: true,
                    useCreateIndex: true,
                    useUnifiedTopology: true
                }).then(()=>{
                this.logger.info("Mongo connection success");
            },error=>{
                this.logger.error("Can't install mongodb connection",error);
            });
        }
    }


    static get loggerGroup(){
        return 'model'
    }
    initHooks(){

    }
}
module.exports = AbstractModel;