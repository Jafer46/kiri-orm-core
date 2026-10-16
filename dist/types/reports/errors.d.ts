/**
 * A report definition that doesn't hold up - bad shape (caught when it is defined) or not
 * matching the models it reads (caught the first time it is used, since the models may be
 * registered after the report). `cause` carries the underlying ValidationError, if any.
 */
export declare class ReportDefinitionError extends Error {
    reportName: any;
    constructor(reportName: any, message: any, options?: {});
}
