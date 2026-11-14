import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Forward rejected promises from async route handlers to the error middleware (Express 4). */
export const asyncHandler =
  <R extends Request = Request>(fn: (req: R, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req as R, res, next).catch(next);
  };
