import { Request, Response, NextFunction } from 'express';
import ServiceLocator from "../../ServiceLocator";

const AccountService = ServiceLocator.accountService()

const getUserToken = async (req: Request, res: Response, next: NextFunction) => {
    // Under BACKEND_PLATFORM=netlify the frontend uses the Netlify Identity
    // widget (gotrue-js), which handles token exchange directly with
    // /.netlify/identity/token. This endpoint just returns a hint instead of
    // 500ing so the migration is debuggable.
    if (process.env.BACKEND_PLATFORM === 'netlify') {
        res.status(410).json({
            error: 'Gone',
            message:
                'Token exchange is handled by the Netlify Identity widget. ' +
                'POST your credentials to /.netlify/identity/token directly.',
        });
        return;
    }
    const data = await AccountService.getToken(req)
    res.json(data)
}

export {
    getUserToken,
}