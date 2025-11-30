import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { protect, protectAdmin } from '../../middleware/authMiddleware';
import User from '../../models/User';
import Admin from '../../models/Admin';
import { IUser } from '../../models/User'; // Import the type

// Mock express-async-handler to just return the function it's given
// This allows us to test the middleware function directly
jest.mock('express-async-handler', () => (fn: any) => fn);

// Mock the User model
jest.mock('../../models/User');

// Mock the Admin model
jest.mock('../../models/Admin');

// Mock the jsonwebtoken library
jest.mock('jsonwebtoken');

// Type-cast the mocked modules
const mockedUser = User as jest.Mocked<typeof User>;
const mockedAdmin = Admin as jest.Mocked<typeof Admin>;
const mockedJwt = jwt as jest.Mocked<typeof jwt>;

describe('Auth Middleware (protect)', () => {

  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction; // This will be our spy

  const mockUserPayload = {
    _id: 'user123',
    username: 'testuser',
    email: 'test@example.com',
    role: 'user',
  };

  // Reset mocks before each test
  beforeEach(() => {
    // This is more robust than clearAllMocks. It resets implementations.
    jest.clearAllMocks();

    mockRequest = {
      headers: {},
    };
    mockResponse = {
      status: jest.fn(() => mockResponse as Response),
      json: jest.fn(() => mockResponse as Response),
    };
    // Create a fresh Jest mock function for each test
    nextFunction = jest.fn();

    process.env.JWT_SECRET = 'your_test_secret';
  });

  // Test 1: The "Happy Path" - success case
  it('should call next() with no arguments if token is valid', async () => {
    mockRequest.headers = {
      authorization: 'Bearer validtoken123',
    };

    mockedJwt.verify.mockReturnValue({ userId: 'user123' } as any);
    mockedUser.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue(mockUserPayload),
    } as any);

    // We don't wrap this in try...catch because we expect it to succeed
    await protect(mockRequest as Request, mockResponse as Response, nextFunction);

    // Assertions
    expect(mockRequest.user).toStrictEqual(mockUserPayload);
    expect(nextFunction).toHaveBeenCalledTimes(1);
    expect(nextFunction).toHaveBeenCalledWith(); // Called with no arguments
  });

  // Test 2: Failure case - no token
  it('should throw and call status(401) if no token is provided', async () => {
    let error: Error | null = null;
    try {
      // We wrap the await in try...catch to handle the error
      await protect(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    // Assertions
    expect(mockResponse.status).toHaveBeenCalledWith(401);
    // We check the error that was thrown
    expect(error).not.toBeNull();
    expect(error?.message).toBe('Authorization header missing — token not provided.');
    // next() should NOT have been called because the throw stops execution
    // (asyncHandler calls next(error), which is what we caught)
    expect(nextFunction).not.toHaveBeenCalled();
  });

  // Test 3: Failure case - invalid token format
  it('should throw and call status(401) if token format is invalid (no Bearer)', async () => {
    mockRequest.headers = {
      authorization: 'invalidtoken123',
    };

    let error: Error | null = null;
    try {
      await protect(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    // Assertions
    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(error).not.toBeNull();
    expect(error?.message).toBe("Invalid Authorization format — expected 'Bearer <token>'.");
    expect(nextFunction).not.toHaveBeenCalled();
  });

  // Test 4: Failure case - token verification fails
  it('should throw and call status(401) if token verification fails', async () => {
    mockRequest.headers = {
      authorization: 'Bearer badtoken123',
    };

    mockedJwt.verify.mockImplementation(() => {
      throw new jwt.JsonWebTokenError('Verification failed');
    });

    let error: Error | null = null;
    try {
      await protect(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    // Assertions
    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(error).not.toBeNull();
    expect(error?.message).toBe('Token verification failed — invalid or tampered token.');
    expect(nextFunction).not.toHaveBeenCalled();
  });

  // Test 5: Failure case - user not found
  it('should throw and call status(500) if user not found in database', async () => {
    mockRequest.headers = {
      authorization: 'Bearer validtoken123',
    };

    mockedJwt.verify.mockReturnValue({ userId: 'user123' } as any);
    mockedUser.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue(null), // User.findById returns null
    } as any);

    let error: Error | null = null;
    try {
      await protect(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    // Assertions
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(error).not.toBeNull();
    expect(error?.message).toContain('Database lookup failed');
    expect(nextFunction).not.toHaveBeenCalled();
  });

  // Test 6: Failure case - token expired
  it('should throw and call status(401) if token is expired', async () => {
    mockRequest.headers = {
      authorization: 'Bearer expiredtoken123',
    };

    const expiredError = new jwt.TokenExpiredError('jwt expired', new Date());

    mockedJwt.verify.mockImplementation(() => {
      throw expiredError;
    });

    let error: Error | null = null;
    try {
      await protect(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    // Assertions
    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(error).not.toBeNull();
    expect(error?.message === 'Token verification failed — token has expired.').toBe(true);
    expect(nextFunction).not.toHaveBeenCalled();
  });

  // Test 7: Token missing after "Bearer " — ensure empty token string is handled.
  it('should throw and call status(401) if token is empty after Bearer', async () => {
    mockRequest.headers = {
      authorization: 'Bearer ',
    };

    let error: Error | null = null;
    try {
      await protect(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(error).not.toBeNull();
    expect(error?.message).toBe("Token is empty — please provide a valid token after \'Bearer\'.");
    expect(nextFunction).not.toHaveBeenCalled();
  });

  // Test 8: Corrupted payload type — invalid `userId` type should fail.
  it('should throw and call status(500) if token payload userId is invalid type', async () => {
    mockRequest.headers = {
      authorization: 'Bearer validtoken123',
    };

    mockedJwt.verify.mockReturnValue({ userId: 12345 } as any); // userId should be string, here number

    let error: Error | null = null;
    try {
      await protect(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(error).not.toBeNull();
    expect(error?.message).toContain('Database lookup failed');
    expect(nextFunction).not.toHaveBeenCalled();
  });

  // Test 9: Missing `JWT_SECRET` — ensure the middleware handles missing environment variable safely.
  it('should throw and call status(401) if JWT_SECRET environment variable is missing', async () => {
    delete process.env.JWT_SECRET;

    mockRequest.headers = {
      authorization: 'Bearer validtoken123',
    };

    mockedJwt.verify.mockImplementation(() => {
      throw new jwt.JsonWebTokenError('secret or public key must be provided');
    });

    let error: Error | null = null;
    try {
      await protect(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    // Reset JWT_SECRET for other tests
    process.env.JWT_SECRET = 'your_test_secret';

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(error).not.toBeNull();
    expect(error?.message).toBe('Token verification failed — invalid or tampered token.');
    expect(nextFunction).not.toHaveBeenCalled();
  });

  // Test 10: Token not yet active (NotBeforeError)
  it('should throw and call status(401) if token is not yet active', async () => {
    mockRequest.headers = {
      authorization: 'Bearer notbeforetoken123',
    };

    const notBeforeError = new jwt.NotBeforeError('jwt not active', new Date());

    mockedJwt.verify.mockImplementation(() => {
      throw notBeforeError;
    });

    let error: Error | null = null;
    try {
      await protect(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(error).not.toBeNull();
    expect(error?.message).toBe('Token verification failed — token not yet active.');
    expect(nextFunction).not.toHaveBeenCalled();
  });

  // Test 11: Unexpected token verification error
  it('should throw and call status(401) if unexpected token error occurs', async () => {
    mockRequest.headers = {
      authorization: 'Bearer unexpectedtoken123',
    };

    mockedJwt.verify.mockImplementation(() => {
      throw new Error('Unexpected verification error');
    });

    let error: Error | null = null;
    try {
      await protect(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(error).not.toBeNull();
    expect(error?.message).toBe('Unexpected token verification error: Unexpected verification error');
    expect(nextFunction).not.toHaveBeenCalled();
  });
});

describe('Auth Middleware (protectAdmin)', () => {

  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  const mockAdminPayload = {
    _id: 'admin123',
    username: 'adminuser',
    email: 'admin@example.com',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {
      headers: {},
    };
    mockResponse = {
      status: jest.fn(() => mockResponse as Response),
      json: jest.fn(() => mockResponse as Response),
    };
    nextFunction = jest.fn();

    process.env.JWT_SECRET = 'your_test_secret';
    process.env.ADMIN_TOKEN = 'test-admin-token';
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_EMAIL = 'admin@example.com';
  });

  // Test 1: Success case - valid admin JWT token
  it('should call next() with no arguments if admin token is valid', async () => {
    mockRequest.headers = {
      authorization: 'Bearer validadmintoken123',
    };

    mockedJwt.verify.mockReturnValue({ id: 'admin123' } as any);
    mockedAdmin.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue(mockAdminPayload),
    } as any);

    await protectAdmin(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockRequest.user).toBe(mockAdminPayload);
    expect(nextFunction).toHaveBeenCalledTimes(1);
    expect(nextFunction).toHaveBeenCalledWith();
  });

  // Test 2: Success case - hardcoded admin token
  it('should authenticate with hardcoded admin token and call next()', async () => {
    mockRequest.headers = {
      authorization: 'Bearer test-admin-token',
    };

    await protectAdmin(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockRequest.user).toEqual({
      _id: 'admin-env',
      username: 'admin',
      email: 'admin@example.com',
    });
    expect(nextFunction).toHaveBeenCalledTimes(1);
    expect(nextFunction).toHaveBeenCalledWith();
    // JWT verify should NOT be called for hardcoded token
    expect(mockedJwt.verify).not.toHaveBeenCalled();
  });

  // Test 3: Failure case - no token
  it('should throw and call status(401) if no token is provided', async () => {
    let error: Error | null = null;
    try {
      await protectAdmin(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(error).not.toBeNull();
    expect(error?.message).toBe('Authorization header missing — token not provided.');
    expect(nextFunction).not.toHaveBeenCalled();
  });

  // Test 4: Failure case - invalid token format
  it('should throw and call status(401) if token format is invalid (no Bearer)', async () => {
    mockRequest.headers = {
      authorization: 'invalidtoken123',
    };

    let error: Error | null = null;
    try {
      await protectAdmin(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(error).not.toBeNull();
    expect(error?.message).toBe("Invalid Authorization format — expected 'Bearer <token>'.");
    expect(nextFunction).not.toHaveBeenCalled();
  });

  // Test 5: Failure case - empty token after Bearer
  it('should throw and call status(401) if token is empty after Bearer', async () => {
    mockRequest.headers = {
      authorization: 'Bearer ',
    };

    let error: Error | null = null;
    try {
      await protectAdmin(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(error).not.toBeNull();
    expect(error?.message).toBe("Token is empty — please provide a valid token after 'Bearer'.");
    expect(nextFunction).not.toHaveBeenCalled();
  });

  // Test 6: Failure case - token verification fails
  it('should throw and call status(401) if token verification fails', async () => {
    mockRequest.headers = {
      authorization: 'Bearer badtoken123',
    };

    mockedJwt.verify.mockImplementation(() => {
      throw new jwt.JsonWebTokenError('Verification failed');
    });

    let error: Error | null = null;
    try {
      await protectAdmin(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(error).not.toBeNull();
    expect(error?.message).toBe('Token verification failed — invalid or tampered token.');
    expect(nextFunction).not.toHaveBeenCalled();
  });

  // Test 7: Failure case - token expired
  it('should throw and call status(401) if token is expired', async () => {
    mockRequest.headers = {
      authorization: 'Bearer expiredtoken123',
    };

    const expiredError = new jwt.TokenExpiredError('jwt expired', new Date());

    mockedJwt.verify.mockImplementation(() => {
      throw expiredError;
    });

    let error: Error | null = null;
    try {
      await protectAdmin(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(error).not.toBeNull();
    expect(error?.message).toBe('Token verification failed — token has expired.');
    expect(nextFunction).not.toHaveBeenCalled();
  });

  // Test 8: Failure case - admin not found
  it('should throw and call status(401) if admin not found in database', async () => {
    mockRequest.headers = {
      authorization: 'Bearer validtoken123',
    };

    mockedJwt.verify.mockReturnValue({ id: 'admin123' } as any);
    mockedAdmin.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue(null),
    } as any);

    let error: Error | null = null;
    try {
      await protectAdmin(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(error).not.toBeNull();
    expect(error?.message).toBe('Authentication failed — admin not found or has been removed.');
    expect(nextFunction).not.toHaveBeenCalled();
  });

  // Test 9: Failure case - missing JWT_SECRET
  it('should throw and call status(401) if JWT_SECRET environment variable is missing', async () => {
    delete process.env.JWT_SECRET;

    mockRequest.headers = {
      authorization: 'Bearer validtoken123',
    };

    mockedJwt.verify.mockImplementation(() => {
      throw new jwt.JsonWebTokenError('secret or public key must be provided');
    });

    let error: Error | null = null;
    try {
      await protectAdmin(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    // Reset JWT_SECRET for other tests
    process.env.JWT_SECRET = 'your_test_secret';

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(error).not.toBeNull();
    expect(error?.message).toBe('Token verification failed — invalid or tampered token.');
    expect(nextFunction).not.toHaveBeenCalled();
  });

  // Test 10: Token not yet active (NotBeforeError)
  it('should throw and call status(401) if token is not yet active', async () => {
    mockRequest.headers = {
      authorization: 'Bearer notbeforetoken123',
    };

    const notBeforeError = new jwt.NotBeforeError('jwt not active', new Date());

    mockedJwt.verify.mockImplementation(() => {
      throw notBeforeError;
    });

    let error: Error | null = null;
    try {
      await protectAdmin(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(error).not.toBeNull();
    expect(error?.message).toBe('Token verification failed — token not yet active.');
    expect(nextFunction).not.toHaveBeenCalled();
  });

  // Test 11: Unexpected token verification error
  it('should throw and call status(401) if unexpected token error occurs', async () => {
    mockRequest.headers = {
      authorization: 'Bearer unexpectedtoken123',
    };

    mockedJwt.verify.mockImplementation(() => {
      throw new Error('Unexpected verification error');
    });

    let error: Error | null = null;
    try {
      await protectAdmin(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(error).not.toBeNull();
    expect(error?.message).toBe('Unexpected token verification error: Unexpected verification error');
    expect(nextFunction).not.toHaveBeenCalled();
  });

  // Test 12: Database error during admin lookup
  it('should throw and call status(500) if database error occurs during admin lookup', async () => {
    mockRequest.headers = {
      authorization: 'Bearer validtoken123',
    };

    mockedJwt.verify.mockReturnValue({ id: 'admin123' } as any);

    // Mock findById to throw a database error
    mockedAdmin.findById.mockImplementation(() => {
      throw new Error('Database connection failed');
    });

    let error: Error | null = null;
    try {
      await protectAdmin(mockRequest as Request, mockResponse as Response, nextFunction);
    } catch (e: any) {
      error = e;
    }

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(error).not.toBeNull();
    expect(error?.message).toContain('Database lookup failed');
    expect(error?.message).toContain('Database connection failed');
    expect(nextFunction).not.toHaveBeenCalled();
  });
});
