"use strict";
const express = require('express');
const http = require('http');
const bodyParser = require('body-parser');
const cors = require('cors');

const i18next = require('i18next');
const i18nextMiddleware = require('i18next-express-middleware');
const Backend = require('i18next-node-fs-backend');


const Base = require('../../modules/Base');


class HttpServer extends Base{
    constructor(app, folderConfig){
        super(app);
        this.express = express();
        this.express.set('views', [folderConfig.folders.views,__dirname+'/../../views']);
        this.express.set('view engine', 'pug');
        this.express.use((req,res,next)=>{
            this.logger.info(`Request is  ${req.url}`);
            next();
        });
        this.enableI18N();

        const httpConfig = this.app.getConfig("http");
        this.express.use(cors({
            origin: httpConfig.corsDomains

        }));//todo whitelist
        this.express.use(bodyParser.urlencoded({limit: '50mb', extended: true }));
        this.express.use(bodyParser.json({limit: '50mb'}));
        this.express.use(express.static(folderConfig.folders.public));
        this.express.use(express.static('./public'));

        this.express.use((err, req, res, next) =>{//error handling
            console.error(err.stack);
            //TODO
            res.status(500).send('Something broke!')
        });

        this.httpServer = http.Server(this.express);
      
        let listener = this.httpServer.listen(httpConfig.port,httpConfig.hostname,  ()=> {
            this.logger.info(`App started and listening on port ${listener.address().port}`);
            if (listener.address().port !== httpConfig.port){//in case we using port 0
                this.app.updateConfig("http",{port:listener.address().port});
                this.logger.info(`Updating http config to use new port`);

            }
            
        });
    }
    enableI18N(){
        let I18NConfig = this.app.getConfig("i18n");
        if (!I18NConfig.enabled){
            return;
        }
        let  lngDetector = new i18nextMiddleware.LanguageDetector();
        lngDetector.addDetector({
            name: 'xLang',
            lookup: function(req, res, options) {
                let lng = req.get("X-Lang");
                if (lng){
                    return lng;
                }
            },
            cacheUserLanguage: function(req, res, lng, options) {

            }
        });
        this.logger.info("Enabling i18n support");
        i18next
            .use(Backend)
            .use(lngDetector)
            .init({
                backend: {
                    loadPath: __dirname + '/../../locales/{{lng}}/{{ns}}.json',
                    addPath: __dirname + '/../../locales/{{lng}}/{{ns}}.json'
                },
                fallbackLng: I18NConfig.fallbackLng,
                preload: I18NConfig.preload,
                saveMissing: false,
                debug:false,
                detection:{
                    //caches: ['cookie'],
                    order:['xLang']
                },

            });
        this.express.use(i18nextMiddleware.handle(i18next));
        this.express.use(function (req,res,next) {//fix ru-Ru, en-US, etc
            if (res.locals.language.length !== 2){
                res.locals.language = res.locals.language.split("-")[0];
            }
            next();

        });
    }

    add404Page(){
        this.express.use(( req, res, next) =>{//error handling
           res.status(404).render('404')
        });
    }

    static get loggerGroup(){
        return 'service'
    }

    die(){
        this.httpServer.close();
    }
}
module.exports = HttpServer;