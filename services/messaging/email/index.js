"use strict";
const fs = require("fs");
const EmailTemplate = require('email-templates');
const nodemailer = require('nodemailer');

const mailTransports = {
        sendMail: require('nodemailer-sendmail-transport'),
        stub: require('nodemailer-stub-transport'),
        smtp: data => data
    };
const path = require("path");
const Base = require("../../../modules/Base");

// const i18next = require('i18next');

class Mail extends Base {
    constructor(app,template, templateData, i18n) {
        super(app);
        if(!path.isAbsolute(template)){
            if (this.app.folderConfig && fs.existsSync(this.app.folderConfig + "/" +path.basename(template))) {
                this.template = this.app.folderConfig + "/" +path.basename(template)
            } else
            if (fs.existsSync(__dirname+'/templates/' + path.basename(template))) {
                this.template = __dirname+'/templates/' + path.basename(template)
            }
            else {
                console.log("not found")
            }
        }
        this.templateData = templateData;
        this.i18n = i18n;
        this.locale = this.i18n.language;
    }

    /**
     * Send email
     * @param to
     * @param [from = mailConfig.from]
     * @return {Promise}
     */
    async send(to, from) {
        const mailConfig = this.app.getConfig("mail");
        if (!from){
            from = mailConfig.from;
        }
        const siteDomain = this.app.getConfig("http").siteDomain;
        let transportConfig = mailConfig.transports[mailConfig.transport];
        let transport = mailTransports[mailConfig.transport];
        let transporter = nodemailer.createTransport(transport(transportConfig));




        const email = new EmailTemplate({
            message: {
                from: from
            },
            send: true,
            preview:false,
            transport:transporter
        });

        return await email.send({
                template: this.template,
                message: {
                    to: to
                },
                locals: Object.assign(
                    {
                        locale:this.locale,
                        serverDomain:mailConfig.myDomain,
                        siteDomain:siteDomain,
                        t: this.i18n.t.bind(this.i18n),
                    },
                    this.templateData),
            });
    }

    render() {
        //TODO for debug
    }

    static get loggerGroup(){
        return 'messaging'
    }
}

module.exports = Mail;