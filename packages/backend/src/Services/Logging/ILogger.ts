// ILoggingContext was previously a union of ICustomContext | IRequest so that
// Express request objects could be passed straight to Logger.* calls. Post
// Express→Hono migration, controllers pass `c.var.logCtx` (an ICustomContext)
// instead, and the union collapsed.

export interface ICustomContext {
    contextId?: string;
    logPrefix?: string;
}

export type ILoggingContext = ICustomContext;

export interface ILogger {
    debug(context?: ILoggingContext, message?: any, ...optionalParams: any[]): void;
    info(context?: ILoggingContext, message?: any, ...optionalParams: any[]): void;
    warn(context?: ILoggingContext, message?: any, ...optionalParams: any[]): void;
    error(context?: ILoggingContext, message?: any, ...optionalParams: any[]): void;
}
