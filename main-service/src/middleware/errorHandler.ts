import type { ErrorRequestHandler, RequestHandler } from "express";
import mongoose from "mongoose";
import { env } from "../config/env";
import { HttpError } from "../utils/HttpError";

export const notFound: RequestHandler = (req, _res, next) => {
  next(HttpError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let status = 500;
  let message = "Internal server error";
  let details: unknown;

  if (err instanceof HttpError) {
    ({ status, message, details } = err);
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    message = `Invalid ${err.path}`;
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    message = "Validation failed";
    details = err.errors;
  } else if (err?.type === "entity.parse.failed") {
    status = 400;
    message = "Malformed JSON body";
  }

  if (status >= 500) console.error(err);
  res.status(status).json({
    error: { status, message, ...(details ? { details } : {}) },
    ...(env.NODE_ENV === "development" && status >= 500 ? { stack: (err as Error)?.stack } : {}),
  });
};
