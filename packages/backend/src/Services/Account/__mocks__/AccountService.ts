import Logger from "../../Logging/Logger";
import AccountServiceUtils from "../AccountServiceUtils";
import type { ReqLike } from '../AccountService';

const jwt = require('jsonwebtoken');

export default class AccountService {
    privateKey = "privateKey";
    publicKey = "publicKey";
    verify = false;

    constructor() {}

    getToken = async (_req: any) => ({});

    extractUserFromRequest = (req: ReqLike, customKey?: string) => {
        const cookies = req.cookies ?? {};
        const token = customKey ? cookies.custom_id_token : cookies.id_token;
        if (!this.verify) return jwt.decode(token);
        if (token) {
            if (customKey) Logger.debug(undefined, "using custom authKey");
            const key = customKey ? customKey : this.privateKey;
            return AccountServiceUtils.extractUserFromRequest(req, token, key);
        }
        return null;
    };
}
