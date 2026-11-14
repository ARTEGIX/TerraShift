import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny, z } from "zod";
import { HttpError } from "../utils/HttpError";

/** Validate and replace `req.body` with the parsed (typed, defaulted) value. */
export const validateBody =
  <S extends ZodTypeAny>(schema: S) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(HttpError.badRequest("Validation failed", result.error.flatten()));
    }
    req.body = result.data as z.infer<S>;
    next();
  };
