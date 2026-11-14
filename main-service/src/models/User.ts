import bcrypt from "bcryptjs";
import { Schema, model, type HydratedDocument, type Model } from "mongoose";
import { env } from "../config/env";

export type UserRole = "farmer" | "advisor" | "admin";

export interface IUser {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

interface IUserMethods {
  verifyPassword(plain: string): Promise<boolean>;
  toPublic(): { id: string; name: string; email: string; role: UserRole; createdAt: Date };
}

type UserModel = Model<IUser, object, IUserMethods> & {
  hashPassword(plain: string): Promise<string>;
};

const userSchema = new Schema<IUser, UserModel, IUserMethods>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["farmer", "advisor", "admin"], default: "farmer" },
  },
  { timestamps: true },
);

userSchema.static("hashPassword", (plain: string) => bcrypt.hash(plain, env.BCRYPT_ROUNDS));

userSchema.method("verifyPassword", function (this: HydratedDocument<IUser>, plain: string) {
  return bcrypt.compare(plain, this.passwordHash);
});

userSchema.method("toPublic", function (this: HydratedDocument<IUser>) {
  return { id: this.id as string, name: this.name, email: this.email, role: this.role, createdAt: this.createdAt };
});

export const User = model<IUser, UserModel>("User", userSchema);
