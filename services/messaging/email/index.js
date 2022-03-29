const fs = require('fs');
const EmailTemplate = require('email-templates');
const nodemailer = require('nodemailer');
const sendMail = require('nodemailer-sendmail-transport');
const stub = require('nodemailer-stub-transport');

const mailTransports = {
  sendMail,
  stub,
  smtp: (data) => data,
};
const path = require('path');
const Base = require('../../../modules/Base');

// const i18next = require('i18next');

class Mail extends Base {
  constructor(app, template, templateData, i18n) {
    super(app);
    if (!path.isAbsolute(template)) {
      if (
        fs.existsSync(
          `${this.app.foldersConfig.emails}/${path.basename(template)}`,
        )
      ) {
        this.template = `${this.app.foldersConfig.emails}/${path.basename(
          template,
        )}`;
      } else if (
        fs.existsSync(`${__dirname}/templates/${path.basename(template)}`)
      ) {
        this.template = `${__dirname}/templates/${path.basename(template)}`;
      } else {
        this.template = `${__dirname}/templates/emptyTemplate`;
        this.logger.error(
          `Template '${template}' not found. Using 'emptyTemplate' as a fallback`,
        );
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
    const mailConfig = this.app.getConfig('mail');
    if (!from) {
      // eslint-disable-next-line no-param-reassign
      from = mailConfig.from;
    }
    const { siteDomain } = this.app.getConfig('http');
    const transportConfig = mailConfig.transports[mailConfig.transport];
    const transport = mailTransports[mailConfig.transport];
    const transporter = nodemailer.createTransport(transport(transportConfig));

    const email = new EmailTemplate({
      message: {
        from,
      },
      send: true,
      preview: false,
      transport: transporter,
      juiceResources: {
        webResources: mailConfig.webResources,
      },
    });

    return email.send({
      template: this.template,
      message: {
        to,
      },
      locals: {
        locale: this.locale,
        serverDomain: mailConfig.myDomain,
        siteDomain,
        t: this.i18n.t.bind(this.i18n),
        ...this.templateData,
      },
    });
  }

  render() {
    // TODO for debug
  }

  static get loggerGroup() {
    return 'messaging';
  }
}

module.exports = Mail;
