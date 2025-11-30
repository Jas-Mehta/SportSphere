import jwt from 'jsonwebtoken';
import asyncHandler from 'express-async-handler';
import { Request, Response, NextFunction } from 'express';
import User from '../models/User';
import Admin from '../models/Admin';

interface JwtPayload {
  userId: string;
}

// Express Request interface to include a user property.
export interface IUserRequest extends Request {
  user?: any;
}

/**
 * Middleware: Protect routes by verifying JWT in the Authorization header.
 * Provides detailed, expressive error messages for easier debugging.
 */
export const protect = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  let token: string | undefined;
  let decoded: JwtPayload;

  // Validate Authorization header presence and format
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401);
    throw new Error('Authorization header missing — token not provided.');
  }

  if (!authHeader.startsWith('Bearer ')) {
    res.status(401);
    throw new Error("Invalid Authorization format — expected 'Bearer <token>'.");
  }

  // Extract token
  token = authHeader.split(' ')[1];
  if (!token || token.trim() === '') {
    res.status(401);
    throw new Error('Token is empty — please provide a valid token after \'Bearer\'.');
  }

  // Verify token validity
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
  } catch (error: any) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401);
      throw new Error('Token verification failed — token has expired.');
    } else if (error instanceof jwt.JsonWebTokenError) {
      res.status(401);
      throw new Error('Token verification failed — invalid or tampered token.');
    } else if (error instanceof jwt.NotBeforeError) {
      res.status(401);
      throw new Error('Token verification failed — token not yet active.');
    } else {
      res.status(401);
      throw new Error(`Unexpected token verification error: ${error.message}`);
    }
  }

  // Fetch user associated with token
  try {
    const user = await User.findById(decoded.userId).select("-password");

    if (!user) {
      res.status(401);
      throw new Error('Authentication failed — user not found or has been removed.');
    }

    req.user = user;
  } catch (dbError: any) {
    res.status(500);
    throw new Error(`Database lookup failed — could not retrieve user: ${dbError.message}`);
  }

  // 5. Pass control if everything checks out
  next();
});

/**
 * Middleware: Protect admin routes by verifying JWT in the Authorization header.
 * Looks up the admin in the Admin collection instead of User collection.
 */
export const protectAdmin = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  let token: string | undefined;
  let decoded: any;

  // 1. Validate Authorization header presence and format
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401);
    throw new Error('Authorization header missing — token not provided.');
  }

  if (!authHeader.startsWith('Bearer ')) {
    res.status(401);
    throw new Error("Invalid Authorization format — expected 'Bearer <token>'.");
  }

  // 2. Extract token
  token = authHeader.split(' ')[1];
  if (!token || token.trim() === '') {
    res.status(401);
    throw new Error('Token is empty — please provide a valid token after \'Bearer\'.');
  }

  // 2.5. Check for hardcoded admin token
  if (token === process.env.ADMIN_TOKEN) {
    (req as any).user = {
      _id: 'admin-env',
      username: process.env.ADMIN_USERNAME || 'Admin',
      email: process.env.ADMIN_EMAIL || 'admin@example.com'
    };
    return next();
  }

  // 3. Verify token validity
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET as string);
  } catch (error: any) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401);
      throw new Error('Token verification failed — token has expired.');
    } else if (error instanceof jwt.JsonWebTokenError) {
      res.status(401);
      throw new Error('Token verification failed — invalid or tampered token.');
    } else if (error instanceof jwt.NotBeforeError) {
      res.status(401);
      throw new Error('Token verification failed — token not yet active.');
    } else {
      res.status(401);
      throw new Error(`Unexpected token verification error: ${error.message}`);
    }
  }

  // 4. Handle admin authentication
  // If admin is env-based (id === 'admin-env'), create user object from env vars
  if (decoded.id === 'admin-env') {
    (req as any).user = {
      _id: 'admin-env',
      username: process.env.ADMIN_USERNAME || 'Admin',
      email: process.env.ADMIN_EMAIL || 'admin@example.com'
    };
    return next();
  }

  // Otherwise, fetch admin from database
  try {
    (req as any).user = await Admin.findById(decoded.id).select('-password');
  } catch (dbError: any) {
    res.status(500);
    throw new Error(`Database lookup failed — could not retrieve admin: ${dbError.message}`);
  }

  if (!(req as any).user) {
    res.status(401);
    throw new Error('Authentication failed — admin not found or has been removed.');
  }

  // 5. Pass control if everything checks out
  next();
});
