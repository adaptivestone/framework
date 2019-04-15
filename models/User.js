"use strict";
const AbstractModel = require("./../modules/AbstractModel");
const bcrypt = require('bcrypt');


const Mailer = require('../services/messaging').email;

class User extends AbstractModel {
    constructor(app){
        super(app);
        const authConfig = this.app.getConfig("auth");
        this.saltRounds = authConfig.saltRounds;
        this.someSecretSalt = authConfig.someSecretSalt;
    }

    initHooks(){
        this.mongooseSchema.pre('save', async function () {
            if (this.isModified('password')) {
                this.password = await this.constructor.hashPassword(this.password);
            }
        });
    }

    get modelSchema() {
        return {
            avatar: {
                type:String,
                maxlength:255,
            },
            name: {
                first: {
                    type:String,
                    maxlength:255,
                },
                last: {
                    type:String,
                    maxlength:255,
                },
                nick: {
                    minlength:3,
                    maxlength:255,
                    type:String,
                    unique:true,
                }
            },
            password: String,
            email: {
                type:String,
                maxlength:255,
            },
            sessionTokens: [{token: String, valid: Date}],
            verificationTokens: [{until: Date, token: String}],
            passwordRecoveryTokens: [{until: Date, token: String}],
            permissions: [],
            isVerified: {type: Boolean, default: false},
            locale: {type: String, default: 'en'},
            languages: [String],
        }
    }

     static async getUserByEmailAndPassword(email, password) {
        let data = await this.findOne({email: email});
        if (!data) {
            return false;
        }
        let same = await bcrypt.compare(password + this.getSuper().someSecretSalt, data.password);

        if (!same) {
            return false;
        }
        return data;
    }

    async generateToken() {
        let timestamp = new Date();
        timestamp.setDate(timestamp.getDate() + 30);
        let token = await bcrypt.hash(this.email + Date.now(), this.getSuper().saltRounds);
        this.sessionTokens.push({token: token, valid: timestamp});
        await this.save();
        return {token: token, valid: timestamp};
    }

    getPublic() {
        return {
            avatar: this.avatar,
            name: this.name,
            email: this.email,
            _id: this._id,
            defaultWallet: this.defaultWallet,
            isVerified: this.isVerified,
            permissions: this.permissions,
            locale: this.locale
        }
    }

    static async hashPassword(password) {
        return await bcrypt.hash(password + this.getSuper().someSecretSalt, this.getSuper().saltRounds);
        
    }


    static async getUserByToken(token) {
        let data = await this.findOne({'sessionTokens.token': token});
        return data || false;
    }


    static getUserByEmail(email) {
        return new Promise(async (resolve, reject) => {
            let data = await this.findOne({email: email});
            if (!data) {
                return resolve(false);
            }
            return resolve(data);
        });
    }
    static generateUserPasswordRecoveryToken(userMongoose){
        return new Promise((resolve, reject) => {
            let date = new Date();
            date.setDate(date.getDate() + 14);
            bcrypt.hash(userMongoose.email + Date.now(), this.getSuper().saltRounds, (err, token) => {
                if (err) {
                    this.logger.error("Hash 2 error ", err);
                    reject(err);
                    return;
                }
                userMongoose.passwordRecoveryTokens = [];
                userMongoose.passwordRecoveryTokens.push({
                    until: date,
                    token: token
                });
                userMongoose.save();
                resolve({token: token, until: date.getTime()});
            });
        })
    }
    static getUserByPasswordRecoveryToken(passwordRecoveryToken) {
        return new Promise(async (resolve, reject) => {
            let data = await this.findOne({passwordRecoveryTokens: {$elemMatch: {token: passwordRecoveryToken}}});
            console.log(data);
            if (!data) {
                reject(false);
                return;
            }
            //TODO token expiration and remove that token

            data.passwordRecoveryTokens.pop();

            await data.save();
            resolve(data);

        });
    }
    async sendPasswordRecoveryEmail(i18n) {
        let passwordRecoveryToken = await User.generateUserPasswordRecoveryToken(this);
        const mail = new Mailer(
            'recovery',
            {
                link: `${i18n.language}/auth/recovery?password_recovery_token=${passwordRecoveryToken.token}`,
                editor: this.name.nick,
            },
            i18n,
        );
        return mail.send(this.email);
    }
    static generateUserVerificationToken(userMongoose) {
        return new Promise((resolve, reject) => {
            let date = new Date();
            date.setDate(date.getDate() + 14);
            bcrypt.hash(userMongoose.email + Date.now(), this.getSuper().saltRounds, (err, token) => {
                if (err) {
                    this.logger.error("Hash 2 error ", err);
                    reject(err);
                    return;
                }
                userMongoose.verificationTokens = [];
                userMongoose.verificationTokens.push({
                    until: date,
                    token: token
                });
                userMongoose.save();
                resolve({token: token, until: date.getTime()});
            });
        })
    }

    static getUserByVerificationToken(verificationToken) {
        return new Promise(async (resolve, reject) => {
            let data = await this.findOne({verificationTokens: {$elemMatch: {token: verificationToken}}});
            if (!data) {
                reject(false);
                return;
            }
            //TODO token expiration and remove that token

            data.verificationTokens.pop();

            await data.save();
            resolve(data);

        });
    }

    removeVerificationToken(verificationToken) {
        this.mongooseModel.update({verificationTokens: {$elemMatch: {token: verificationToken}}}, {$pop: {verificationTokens: 1}})
    }

    async sendVerificationEmail(i18n) {
        let verificationToken = await User.generateUserVerificationToken(this);
        const mail = new Mailer(
            'verification',
            {
                link: `${i18n.language}/auth/login?verification_token=${verificationToken.token}`,
                editor: this.name.nick,
            },
            i18n,
            );
        return mail.send(this.email);
    }
}


module.exports = User;