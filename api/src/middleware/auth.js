import jwt from 'jsonwebtoken';
import { JWT_SECRET, USER_ROLES } from '../constants.js';
import { getUser, getAdmin } from '../services/database.js';

/**
 * Verify JWT token middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
export function verifyToken(req, res, next) {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Access denied. No token provided or invalid format.'
      });
    }
    
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Verify the token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Add user info to request object
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Access denied. Token has expired.'
      });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Access denied. Invalid token.'
      });
    } else {
      return res.status(500).json({
        success: false,
        error: 'Internal server error during token verification.'
      });
    }
  }
}

/**
 * Role-based access control middleware
 * @param {Array} allowedRoles - Array of allowed roles
 * @returns {Function} - Middleware function
 */
export function requireRole(allowedRoles) {
  return (req, res, next) => {
    try {
      // Check if user is authenticated
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Access denied. User not authenticated.'
        });
      }
      
      // Check if user has required role
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error: 'Access denied. Insufficient permissions.'
        });
      }
      
      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: 'Internal server error during role verification.'
      });
    }
  };
}

/**
 * Middleware to check if user account is active and not locked
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
export async function checkUserStatus(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Access denied. User not authenticated.'
      });
    }
    
    // Only check status for regular users, not admins
    if (req.user.role === USER_ROLES.USER) {
      const user = await getUser(req.user.phone);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User account not found.'
        });
      }
      
      // Check if account is locked due to failed attempts
      if (user.failedAttempts >= 3) {
        return res.status(423).json({
          success: false,
          error: 'Account is locked due to multiple failed login attempts. Please contact support.'
        });
      }
      
      // Add user data to request for convenience
      req.userData = user;
    } else if (req.user.role === USER_ROLES.ADMIN) {
      const admin = await getAdmin(req.user.email);
      
      if (!admin) {
        return res.status(404).json({
          success: false,
          error: 'Admin account not found.'
        });
      }
      
      // Add admin data to request for convenience
      req.adminData = admin;
    }
    
    next();
  } catch (error) {
    console.error('Error checking user status:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error during user status check.'
    });
  }
}

/**
 * Generate JWT token for user
 * @param {Object} userData - User data
 * @param {string} role - User role
 * @returns {string} - JWT token
 */
export function generateToken(userData, role) {
  const payload = {
    phone: userData.phone || undefined,
    email: userData.email || undefined,
    suiAddress: userData.suiAddress || undefined,
    role: role,
    iat: Math.floor(Date.now() / 1000)
  };
  
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '24h' // Token expires in 24 hours
  });
}

/**
 * Validate request body using Joi schema
 * @param {Object} schema - Joi schema
 * @returns {Function} - Middleware function
 */
export function validateRequest(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false, // Return all validation errors
      stripUnknown: true // Remove unknown fields
    });
    
    if (error) {
      const errorMessages = error.details.map(detail => detail.message);
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errorMessages
      });
    }
    
    // Replace req.body with validated and sanitized data
    req.body = value;
    next();
  };
}

/**
 * Validate query parameters using Joi schema
 * @param {Object} schema - Joi schema
 * @returns {Function} - Middleware function
 */
export function validateQuery(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true
    });
    
    if (error) {
      const errorMessages = error.details.map(detail => detail.message);
      return res.status(400).json({
        success: false,
        error: 'Query validation failed',
        details: errorMessages
      });
    }
    
    req.query = value;
    next();
  };
}

/**
 * Error handling middleware
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
export function errorHandler(err, req, res, next) {
  console.error('Unhandled error:', err);
  
  // Don't leak sensitive information in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  return res.status(500).json({
    success: false,
    error: 'Internal server error',
    ...(isDevelopment && { details: err.message, stack: err.stack })
  });
}

/**
 * Rate limiting for USSD endpoints
 * Simple in-memory rate limiter
 */
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // Max 10 requests per minute per phone

export function rateLimitUSSD(req, res, next) {
  const phone = req.body.phoneNumber || req.body.from;
  
  if (!phone) {
    return next();
  }
  
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  // Clean old entries
  for (const [key, data] of requestCounts.entries()) {
    if (data.timestamp < windowStart) {
      requestCounts.delete(key);
    }
  }
  
  // Check current phone's requests
  const phoneRequests = requestCounts.get(phone) || { count: 0, timestamp: now };
  
  if (phoneRequests.count >= RATE_LIMIT_MAX_REQUESTS && phoneRequests.timestamp > windowStart) {
    return res.status(429).send('END Rate limit exceeded. Please try again later.');
  }
  
  // Update request count
  if (phoneRequests.timestamp < windowStart) {
    phoneRequests.count = 1;
    phoneRequests.timestamp = now;
  } else {
    phoneRequests.count += 1;
  }
  
  requestCounts.set(phone, phoneRequests);
  next();
}