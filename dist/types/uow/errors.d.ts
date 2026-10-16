/**
 * Thrown by HookRegistry#on() when registering a hook under a name
 * that isn't one of the known lifecycle hooks - catches a typo'd hook
 * name at registration time rather than it silently never firing.
 */
export declare class InvalidHookNameError extends Error {
    constructor(message: any);
}
