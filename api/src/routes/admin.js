import express from "express";
import bcrypt from "bcryptjs";
import {
  registerAdminSchema,
  loginAdminSchema,
  getUsersSchema,
  getAllTransactionsSchema,
} from "../schemas/admin.js";
import {
  validateRequest,
  validateQuery,
  verifyToken,
  requireRole,
  generateToken,
} from "../middleware/auth.js";
import {
  registerAdmin,
  getAdmin,
  getUsers,
  getAllTransactions,
  getUser,
} from "../services/database.js";
import {
  getOperatorBalance,
  freezeUserWallet,
  unfreezeUserWallet,
} from "../services/sui-contracts.js";
import { USER_ROLES } from "../constants.js";

const router = express.Router();

/**
 * POST /api/admin/register
 * Register a new admin (typically done via direct database access in production)
 */
router.post(
  "/register",
  validateRequest(registerAdminSchema),
  async (req, res) => {
    try {
      const { fullName, email, password } = req.body;

      // Check if admin already exists
      const existingAdmin = await getAdmin(email);
      if (existingAdmin) {
        return res.status(409).json({
          success: false,
          error: "Admin with this email already exists",
        });
      }

      // Hash password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Register admin
      const adminData = await registerAdmin({
        fullName,
        email,
        password: hashedPassword,
      });

      console.log(`✅ Admin registered successfully: ${email}`);

      res.status(201).json({
        success: true,
        message: "Admin registered successfully",
        data: {
          id: adminData.id,
          fullName: adminData.fullName,
          email: adminData.email,
        },
      });
    } catch (error) {
      console.error("❌ Error registering admin:", error);
      res.status(500).json({
        success: false,
        error: "Failed to register admin",
        details: error.message,
      });
    }
  }
);

/**
 * POST /api/admin/login
 * Admin login with email and password
 */
router.post("/login", validateRequest(loginAdminSchema), async (req, res) => {
  try {
    const { email, password } = req.body;

    // Get admin from database
    const admin = await getAdmin(email);
    if (!admin) {
      return res.status(401).json({
        success: false,
        error: "Invalid email or password",
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, admin.password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: "Invalid email or password",
      });
    }

    // Generate JWT token
    const token = generateToken(admin, USER_ROLES.ADMIN);

    console.log(`✅ Admin logged in successfully: ${email}`);

    res.json({
      success: true,
      message: "Login successful",
      data: {
        token,
        admin: {
          id: admin.id,
          fullName: admin.fullName,
          email: admin.email,
        },
      },
    });
  } catch (error) {
    console.error("❌ Error during admin login:", error);
    res.status(500).json({
      success: false,
      error: "Failed to login",
      details: error.message,
    });
  }
});

/**
 * GET /api/admin/dashboard
 * Get dashboard statistics
 */
router.get(
  "/dashboard",
  verifyToken,
  requireRole([USER_ROLES.ADMIN]),
  async (req, res) => {
    try {
      console.log("🔄 Getting admin dashboard data");

      // Get all users (count only)
      const allUsers = await getUsers(1000, 0);
      const totalUsers = allUsers.length;

      // Get recent users (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentUsers = allUsers.filter(
        (user) => new Date(user.createdAt) > thirtyDaysAgo
      );

      // Get all transactions
      const allTransactions = await getAllTransactions(1000, 0);
      const totalTransactions = allTransactions.length;

      // Calculate transaction statistics
      const successfulTransactions = allTransactions.filter(
        (tx) => tx.status === "success"
      ).length;
      const failedTransactions = allTransactions.filter(
        (tx) => tx.status === "failed"
      ).length;
      const pendingTransactions = allTransactions.filter(
        (tx) => tx.status === "pending"
      ).length;

      // Calculate total transaction volume
      const totalVolume = allTransactions
        .filter((tx) => tx.status === "success")
        .reduce((sum, tx) => sum + tx.amount, 0);

      // Get operator balance
      let operatorBalance = 0;
      try {
        operatorBalance = await getOperatorBalance();
      } catch (error) {
        console.error("Error getting operator balance:", error);
      }

      // Get recent transactions (last 10)
      const recentTransactions = allTransactions.slice(0, 10).map((tx) => ({
        id: tx.id,
        senderName: tx.senderName,
        receiverName: tx.receiverName,
        amount: tx.amount,
        status: tx.status,
        timestamp: tx.timestamp,
        txHash: tx.txHash,
      }));

      res.json({
        success: true,
        data: {
          statistics: {
            totalUsers,
            newUsers: recentUsers.length,
            totalTransactions,
            successfulTransactions,
            failedTransactions,
            pendingTransactions,
            totalVolume: totalVolume.toFixed(6),
            operatorBalance: operatorBalance.toFixed(6),
          },
          recentTransactions,
          systemHealth: {
            status: "healthy",
            uptime: process.uptime(),
            nodeVersion: process.version,
            platform: process.platform,
          },
        },
      });
    } catch (error) {
      console.error("❌ Error getting dashboard data:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get dashboard data",
        details: error.message,
      });
    }
  }
);

/**
 * GET /api/admin/users
 * Get all users with pagination
 */
router.get(
  "/users",
  verifyToken,
  requireRole([USER_ROLES.ADMIN]),
  validateQuery(getUsersSchema),
  async (req, res) => {
    try {
      const { limit, offset } = req.query;

      console.log(`🔄 Getting users with limit ${limit}, offset ${offset}`);
      const users = await getUsers(limit, offset);

      // Format users for response (exclude sensitive data)
      const formattedUsers = users.map((user) => ({
        phone: user.phone,
        fullName: user.fullName,
        suiAddress: user.suiAddress,
        failedAttempts: user.failedAttempts,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      }));

      res.json({
        success: true,
        data: {
          users: formattedUsers,
          pagination: {
            limit,
            offset,
            total: formattedUsers.length,
          },
        },
      });
    } catch (error) {
      console.error("❌ Error getting users:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get users",
        details: error.message,
      });
    }
  }
);

/**
 * GET /api/admin/transactions
 * Get all transactions with pagination
 */
router.get(
  "/transactions",
  verifyToken,
  requireRole([USER_ROLES.ADMIN]),
  validateQuery(getAllTransactionsSchema),
  async (req, res) => {
    try {
      const { limit, offset } = req.query;

      console.log(
        `🔄 Getting transactions with limit ${limit}, offset ${offset}`
      );
      const transactions = await getAllTransactions(limit, offset);

      // Format transactions for response
      const formattedTransactions = transactions.map((tx) => ({
        id: tx.id,
        senderPhone: tx.senderPhone,
        senderName: tx.senderName,
        receiverPhone: tx.receiverPhone,
        receiverName: tx.receiverName,
        amount: tx.amount,
        status: tx.status,
        txHash: tx.txHash,
        errorMessage: tx.errorMessage,
        timestamp: tx.timestamp,
      }));

      res.json({
        success: true,
        data: {
          transactions: formattedTransactions,
          pagination: {
            limit,
            offset,
            total: formattedTransactions.length,
          },
        },
      });
    } catch (error) {
      console.error("❌ Error getting transactions:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get transactions",
        details: error.message,
      });
    }
  }
);

/**
 * GET /api/admin/user/:phone
 * Get specific user details
 */
router.get(
  "/user/:phone",
  verifyToken,
  requireRole([USER_ROLES.ADMIN]),
  async (req, res) => {
    try {
      const { phone } = req.params;

      // Validate phone parameter
      if (!/^\+?[1-9]\d{1,14}$/.test(phone)) {
        return res.status(400).json({
          success: false,
          error: "Invalid phone number format",
        });
      }

      console.log(`🔄 Getting user details for ${phone}`);
      const { getUser, getUserTransactions } = await import(
        "../services/database.js"
      );
      const { getBalance } = await import("../services/sui.js");

      const user = await getUser(phone);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }

      // Get user's balance
      let balance = 0;
      try {
        balance = await getBalance(user.suiAddress);
      } catch (error) {
        console.error("Error getting user balance:", error);
      }

      // Get user's recent transactions
      const transactions = await getUserTransactions(phone, 20, 0);

      res.json({
        success: true,
        data: {
          user: {
            phone: user.phone,
            fullName: user.fullName,
            suiAddress: user.suiAddress,
            publicKey: user.publicKey,
            balance: balance.toFixed(6),
            failedAttempts: user.failedAttempts,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          },
          transactions: transactions.map((tx) => ({
            id: tx.id,
            type: tx.senderPhone === phone ? "sent" : "received",
            counterparty:
              tx.senderPhone === phone
                ? {
                    phone: tx.receiverPhone,
                    name: tx.receiverName,
                  }
                : {
                    phone: tx.senderPhone,
                    name: tx.senderName,
                  },
            amount: tx.amount,
            status: tx.status,
            txHash: tx.txHash,
            timestamp: tx.timestamp,
          })),
        },
      });
    } catch (error) {
      console.error("❌ Error getting user details:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get user details",
        details: error.message,
      });
    }
  }
);

/**
 * GET /api/admin/system/health
 * Get system health information
 */
router.get(
  "/system/health",
  verifyToken,
  requireRole([USER_ROLES.ADMIN]),
  async (req, res) => {
    try {
      console.log("🔄 Getting system health");

      // Get operator balance
      let operatorBalance = 0;
      let operatorStatus = "unknown";
      try {
        operatorBalance = await getOperatorBalance();
        operatorStatus = operatorBalance > 0.1 ? "healthy" : "low_balance";
      } catch (error) {
        console.error("Error getting operator balance:", error);
        operatorStatus = "error";
      }

      // Check database connectivity
      let dbStatus = "unknown";
      try {
        await getUsers(1, 0);
        dbStatus = "healthy";
      } catch (error) {
        console.error("Database health check failed:", error);
        dbStatus = "error";
      }

      res.json({
        success: true,
        data: {
          status: "healthy",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version,
          platform: process.platform,
          services: {
            database: {
              status: dbStatus,
            },
            suiOperator: {
              status: operatorStatus,
              balance: operatorBalance.toFixed(6),
            },
          },
        },
      });
    } catch (error) {
      console.error("❌ Error getting system health:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get system health",
        details: error.message,
      });
    }
  }
);

/**
 * POST /api/admin/wallet/freeze
 * Freeze a user's smart contract wallet
 */
router.post(
  "/wallet/freeze",
  verifyToken,
  requireRole(USER_ROLES.ADMIN),
  async (req, res) => {
    try {
      const { phone } = req.body;

      if (!phone) {
        return res.status(400).json({
          success: false,
          error: "Phone number is required",
        });
      }

      // Get user data
      const user = await getUser(phone);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }

      if (!user.walletObjectId) {
        return res.status(400).json({
          success: false,
          error: "User does not have a smart contract wallet",
        });
      }

      // Freeze the wallet
      const txHash = await freezeUserWallet(user.walletObjectId);

      console.log(
        `✅ Admin froze wallet ${user.walletObjectId} for user ${phone}`
      );

      res.json({
        success: true,
        message: "Wallet frozen successfully",
        data: {
          phone,
          walletObjectId: user.walletObjectId,
          txHash,
          action: "freeze",
        },
      });
    } catch (error) {
      console.error("❌ Error freezing wallet:", error);
      res.status(500).json({
        success: false,
        error: "Failed to freeze wallet",
        details: error.message,
      });
    }
  }
);

/**
 * POST /api/admin/wallet/unfreeze
 * Unfreeze a user's smart contract wallet
 */
router.post(
  "/wallet/unfreeze",
  verifyToken,
  requireRole(USER_ROLES.ADMIN),
  async (req, res) => {
    try {
      const { phone } = req.body;

      if (!phone) {
        return res.status(400).json({
          success: false,
          error: "Phone number is required",
        });
      }

      // Get user data
      const user = await getUser(phone);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }

      if (!user.walletObjectId) {
        return res.status(400).json({
          success: false,
          error: "User does not have a smart contract wallet",
        });
      }

      // Unfreeze the wallet
      const txHash = await unfreezeUserWallet(user.walletObjectId);

      console.log(
        `✅ Admin unfroze wallet ${user.walletObjectId} for user ${phone}`
      );

      res.json({
        success: true,
        message: "Wallet unfrozen successfully",
        data: {
          phone,
          walletObjectId: user.walletObjectId,
          txHash,
          action: "unfreeze",
        },
      });
    } catch (error) {
      console.error("❌ Error unfreezing wallet:", error);
      res.status(500).json({
        success: false,
        error: "Failed to unfreeze wallet",
        details: error.message,
      });
    }
  }
);

export default router;
