import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireAuth, revokeToken, signToken } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { User } from "../models/User";
import { HttpError } from "../utils/HttpError";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { status: 429, message: "Too many attempts, try again later" } },
});

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

/** POST /api/auth/register → { token, user } */
router.post(
  "/register",
  authLimiter,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body as z.infer<typeof registerSchema>;
    if (await User.exists({ email })) throw HttpError.conflict("Email already registered");
    const user = await User.create({ name, email, passwordHash: await User.hashPassword(password) });
    res.status(201).json({ token: signToken(user.id, user.role), user: user.toPublic() });
  }),
);

/** POST /api/auth/login → { token, user } */
router.post(
  "/login",
  authLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const user = await User.findOne({ email }).select("+passwordHash");
    if (!user || !(await user.verifyPassword(password))) throw HttpError.unauthorized("Invalid email or password");
    res.json({ token: signToken(user.id, user.role), user: user.toPublic() });
  }),
);

/** GET /api/auth/me → { user } */
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id);
    if (!user) throw HttpError.unauthorized("User no longer exists");
    res.json({ user: user.toPublic() });
  }),
);

/** POST /api/auth/logout → 204 (revokes the current token) */
router.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeToken(req.user!);
    res.status(204).end();
  }),
);

export default router;
