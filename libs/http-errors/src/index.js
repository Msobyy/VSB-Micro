/**
 * Shared HTTP error type + Express error-handler middleware, used by every
 * service so error responses have one consistent JSON shape:
 *   { error: { message, code, details? } }
 */
export class ApiError extends Error {
  constructor(statusCode, message, { code, details } = {}) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code ?? "ERROR";
    this.details = details;
  }

  static badRequest(message, opts) {
    return new ApiError(400, message, opts);
  }

  static notFound(message, opts) {
    return new ApiError(404, message, opts);
  }

  static conflict(message, opts) {
    return new ApiError(409, message, opts);
  }

  static internal(message, opts) {
    return new ApiError(500, message, opts);
  }
}

/**
 * Must be registered after all routes (same convention vsb-backend uses for
 * its Sentry error handler). Express 5 forwards rejected promises from async
 * route handlers here automatically, so route handlers can just `throw`.
 */
export function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    const isApiError = err instanceof ApiError;
    const statusCode = isApiError ? err.statusCode : 500;

    if (statusCode >= 500) {
      logger.error({ err, path: req.path, method: req.method }, "unhandled error");
    } else {
      logger.warn({ err: err.message, path: req.path, method: req.method }, "request error");
    }

    res.status(statusCode).json({
      error: {
        message: isApiError ? err.message : "Internal server error",
        code: isApiError ? err.code : "INTERNAL_ERROR",
        details: isApiError ? err.details : undefined,
      },
    });
  };
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: "Not found", code: "NOT_FOUND" } });
}
