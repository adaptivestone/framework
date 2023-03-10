const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const nodemailer = require('nodemailer');
const sendMail = require('nodemailer-sendmail-transport');
const stub = require('nodemailer-stub-transport');
const pug = require('pug');
const juice = require('juice');
const { convert } = require('html-to-text');

const mailTransports = {
  sendMail,
  stub,
  smtp: (data) => data,
};
const Base = require('../../../modules/Base');

class Mail extends Base {
  /**
   * Construct mail class
   * @param {object} app
   * @param {string} template template name
   * @param {object} [templateData={}] data to render in template. Object with value that available inside template
   * @param {object} [i18n] data to render in template
   */
  constructor(app, template, templateData = {}, i18n = null) {
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
    this.i18n = i18n ?? {
      t: (str) => str,
      locale: 'en', // todo change it to config
    };
    this.locale = this.i18n?.language;
  }

  /**
   * Render template
   * @param {object} type and fullpath
   * @param {object} templateData
   * @returns string
   */
  static async #renderTemplate({ type, fullPath } = {}, templateData = {}) {
    if (!type) {
      return null;
    }

    switch (type) {
      case 'html':
      case 'text':
      case 'css':
        return fs.promises.readFile(fullPath, { encoding: 'utf8' });
      case 'pug': {
        const compiledFunction = pug.compileFile(fullPath);
        return compiledFunction(templateData);
      }
      default:
        throw new Error(`Template type ${type} is not supported`);
    }
  }

  /**
   * Send email
   * @param {string} to email send to
   * @param {string} [from = mailConfig.from]
   * @param {object} [aditionalNodemailerOptions = {}] additional option to nodemailer
   * @return {Promise}
   */
  async send(to, from = null, aditionalNodemailerOptions = {}) {
    const files = await fs.promises.readdir(this.template);
    const templates = {};
    for (const file of files) {
      const [name, extension] = file.split('.');
      templates[name] = {
        type: extension,
        fullPath: path.join(this.template, file),
      };
    }

    if (!templates.html || !templates.subject) {
      throw new Error(
        'Template HTML and Subject must be provided. Please follow documentation for details https://framework.adaptivestone.com/docs/email',
      );
    }
    const mailConfig = this.app.getConfig('mail');

    const templateDataToRender = {
      locale: this.locale,
      t: this.i18n.t.bind(this.i18n),
      ...mailConfig.globalVariablesToTemplates,
      ...this.templateData,
    };

    const [htmlRendered, subjectRendered, textRendered, extraCss] =
      await Promise.all([
        this.constructor.#renderTemplate(templates.html, templateDataToRender),
        this.constructor.#renderTemplate(
          templates.subject,
          templateDataToRender,
        ),
        this.constructor.#renderTemplate(templates.text, templateDataToRender),
        this.constructor.#renderTemplate(templates.style),
      ]);

    juice.tableElements = ['TABLE'];

    const juiceResourcesAsync = promisify(juice.juiceResources);

    const inlinedHTML = await juiceResourcesAsync(htmlRendered, {
      preserveImportant: true,
      webResources: mailConfig.webResources,
      extraCss,
    });

    return this.constructor.sendRaw(
      this.app,
      to,
      subjectRendered,
      inlinedHTML,
      textRendered,
      from,
      aditionalNodemailerOptions,
    );
  }

  /**
   * Send provided text (html) to email. Low level function. All data should be prepared before sending (like inline styles)
   * @param {objetc} app application
   * @param {string} to send to
   * @param {string} subject email topic
   * @param {string} html hmlt body of emain
   * @param {string} [text] if not provided will be generated from html string
   * @param {string} [from = mailConfig.from] from. If not provided will be grabbed from config
   * @param {object} [additionalNodeMailerOption = {}] any otipns to pass to nodemailer  https://nodemailer.com/message/
   */
  static async sendRaw(
    app,
    to,
    subject,
    html,
    text = null,
    from = null,
    additionalNodeMailerOption = {},
  ) {
    if (!app || !to || !subject || !html) {
      throw new Error('App, to, subject and html is required fields.');
    }
    const mailConfig = app.getConfig('mail');
    if (!from) {
      // eslint-disable-next-line no-param-reassign
      from = mailConfig.from;
    }

    if (!text) {
      // eslint-disable-next-line no-param-reassign
      text = convert(html, {
        selectors: [{ selector: 'img', format: 'skip' }],
      });
    }
    const transportConfig = mailConfig.transports[mailConfig.transport];
    const transport = mailTransports[mailConfig.transport];
    const transporter = nodemailer.createTransport(transport(transportConfig));

    return transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
      ...additionalNodeMailerOption,
    });
  }

  static get loggerGroup() {
    return 'email_';
  }
}

module.exports = Mail;
