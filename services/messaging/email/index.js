"use strict";
const EmailTemplate = require('email-templates');
const nodemailer = require('nodemailer');
const mailConfig = require('../../../config/mail');
const serverDomain = require('../../../config/http').myDomain;
const siteDomain = require('../../../config/http').siteDomain;
const mailTransports = {
        sendMail: require('nodemailer-sendmail-transport'),
        stub: require('nodemailer-stub-transport'),
        smtp: data => data
    };
const path = require("path");
const Base = require("../../../modules/Base");

// const i18next = require('i18next');

class Mail extends Base {
    constructor(template, templateData, i18n) {
        super();
        this.template = template;
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
    async send(to, from = mailConfig.from) {

        let transportConfig = mailConfig.transports[mailConfig.transport];
        let transport = mailTransports[mailConfig.transport];
        let transporter = nodemailer.createTransport(transport(transportConfig));

        const email = new EmailTemplate({
            message: {
                from: from
            },
            views: {
                root: path.resolve(__dirname+'/templates')
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
                        serverDomain:serverDomain,
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