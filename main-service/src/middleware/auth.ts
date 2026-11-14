import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import { redis } from "../db/redis";
import type { UserRole } from "../models/User";
import { HttpError } from "../utils/HttpError";

export interface AuthUser {
  id: string;
  role: UserRole;
  jti: string;
  exp: number;
}

interface TokenClaims extends JwtPayload {
  sub: string;
  role: UserRole;
  jti: string;
}

const ISSUER = "terrashift-main-service";
const revokedKey = (jti: string) => `auth:revoked:${jti}`;

export function signToken(userId: string, role: UserRole): string {
  return jwt.sign({ role }, env.JWT_SECRET, {
    subject: userId,
    jwtid: randomUUID(),
    issuer: ISSUER,
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  });
}

/** Revoke a token until its natural expiry (best effort — requires Redis). */
export async function revokeToken(user: AuthUser): Promise<void> {
  const ttl = Math.max(1, user.exp - Math.floor(Date.now() / 1000));
  try {
    await redis.set(revokedKey(user.jti), "1", "EX", ttl);
  } catch {
    /* Redis down: token simply expires naturally */
  }
}

async function isRevoked(jti: string): Promise<boolean> {
  try {
    return (await redis.exists(revokedKey(jti))) === 1;
  } catch {
    return false;
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}

/** Require a valid Bearer JWT. Populates `req.user`. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) throw HttpError.unauthorized();

    let claims: TokenClaims;
    try {
      claims = jwt.verify(token, env.JWT_SECRET, { issuer: ISSUER }) as TokenClaims;
    } catch {
      throw HttpError.unauthorized("Invalid or expired token");
    }
    if (await isRevoked(claims.jti)) throw HttpError.unauthorized("Token has been revoked");

    req.user = { id: claims.sub, role: claims.role, jti: claims.jti, exp: claims.exp ?? 0 };
    next();
  } catch (err) {
    next(err);
  }
}

/** Role gate — use after `requireAuth`. */
export const requireRole =
  (...roles: UserRole[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(HttpError.unauthorized());
    if (!roles.includes(req.user.role)) return next(HttpError.forbidden());
    next();
  };
