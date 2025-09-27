import express from "express";
import { registerUserSchema, loginUserSchema } from "../schemas/user.js";
import {
  validateRequest,
  verifyToken,
  checkUserStatus,
  generateToken,
} from "../middleware/auth.js";
import { registerUser, getUser, updateUser } from "../services/database.js";
import {
  createUserWallet,
  createSuiFlowWallet,
  fundNewUserAccount,
  getSuiFlowWalletBalance,
} from "../services/sui-contracts.js";
import {
  encryptMnemonic,
  hashPinPhone,
  verifyPinPhone,
} from "../utils/encryption.js";
import { USER_ROLES, MAX_FAILED_ATTEMPTS } from "../constants.js";

const router = express.Router();

/**
 * POST /api/user/new
 * Register a new user and create a Sui wallet
 */
router.post("/new", validateRequest(registerUserSchema), async (req, res) => {
  try {
    const { phone, fullName, pin } = req.body;

    // Check if user already exists
    const existingUser = await getUser(phone);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: "User with this phone number already exists",
      });
    }

    // Create Sui wallet
    console.log(`🔄 Creating wallet for user ${phone}`);
    const walletInfo = createUserWallet();

    // Encrypt mnemonic with user's PIN
    const encryptedMnemonic = encryptMnemonic(walletInfo.mnemonic, pin);

    // Hash PIN with phone for storage
    const pinHash = hashPinPhone(pin, phone);

    // Create SuiFlowWallet smart contract object
    let walletObjectId = null;
    try {
      console.log(`🔄 Creating SuiFlowWallet contract for user ${phone}`);
      const contractResult = await createSuiFlowWallet(walletInfo.mnemonic);
      walletObjectId = contractResult.walletObjectId;
      console.log(`✅ Created SuiFlowWallet contract: ${walletObjectId}`);
    } catch (contractError) {
      console.error(
        "⚠️ Failed to create SuiFlowWallet contract:",
        contractError
      );
      // Continue without contract wallet for now - user can create it later
      // return res.status(500).json({
      //   success: false,
      //   error: 'Failed to create smart contract wallet',
      //   details: contractError.message
      // });
    }

    // Register user in database
    const userData = {
      phone,
      fullName,
      suiAddress: walletInfo.address,
      publicKey: walletInfo.publicKey,
      encryptedMnemonic,
      pinHash,
      walletObjectId,
    };

    await registerUser(userData);

    // Fund the new user's account with gas fees
    console.log(`🔄 Funding new user account ${walletInfo.address}`);
    try {
      const fundingTxHash = await fundNewUserAccount(walletInfo.address);
      console.log(`✅ User funded successfully. TX: ${fundingTxHash}`);
    } catch (fundingError) {
      console.error("⚠️ Failed to fund new user account:", fundingError);
      // Don't fail registration if funding fails, user can be funded later
    }

    console.log(`✅ User registered successfully: ${phone}`);

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: {
        phone,
        fullName,
        suiAddress: walletInfo.address,
        walletObjectId,
      },
    });
  } catch (error) {
    console.error("❌ Error registering user:", error);
    res.status(500).json({
      success: false,
      error: "Failed to register user",
      details: error.message,
    });
  }
});

/**
 * POST /api/user/login
 * User login with phone and PIN
 */
router.post("/login", validateRequest(loginUserSchema), async (req, res) => {
  try {
    const { phone, pin } = req.body;

    // Get user from database
    const user = await getUser(phone);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Invalid phone number or PIN",
      });
    }

    // Check if account is locked
    if (user.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      return res.status(423).json({
        success: false,
        error:
          "Account is locked due to multiple failed login attempts. Please contact support.",
      });
    }

    // Verify PIN
    const isValidPin = verifyPinPhone(pin, phone, user.pinHash);

    if (!isValidPin) {
      // Increment failed attempts
      const newFailedAttempts = user.failedAttempts + 1;
      await updateUser(phone, { failedAttempts: newFailedAttempts });

      const remainingAttempts = MAX_FAILED_ATTEMPTS - newFailedAttempts;

      if (remainingAttempts <= 0) {
        return res.status(423).json({
          success: false,
          error:
            "Account has been locked due to multiple failed login attempts. Please contact support.",
        });
      }

      return res.status(401).json({
        success: false,
        error: `Invalid phone number or PIN. ${remainingAttempts} attempt(s) remaining before account lockout.`,
      });
    }

    // Reset failed attempts on successful login
    if (user.failedAttempts > 0) {
      await updateUser(phone, { failedAttempts: 0 });
    }

    // Generate JWT token
    const token = generateToken(user, USER_ROLES.USER);

    console.log(`✅ User logged in successfully: ${phone}`);

    res.json({
      success: true,
      message: "Login successful",
      data: {
        token,
        user: {
          phone: user.phone,
          fullName: user.fullName,
          suiAddress: user.suiAddress,
        },
      },
    });
  } catch (error) {
    console.error("❌ Error during user login:", error);
    res.status(500).json({
      success: false,
      error: "Failed to login",
      details: error.message,
    });
  }
});

/**
 * GET /api/user/accountInfo
 * Get user account information and balance
 */
router.get("/accountInfo", verifyToken, checkUserStatus, async (req, res) => {
  try {
    const user = req.userData;

    // Get current balance - use smart contract wallet if available, otherwise use regular address
    let balance;
    if (user.walletObjectId) {
      console.log(
        `🔄 Getting balance from SuiFlowWallet ${user.walletObjectId}`
      );
      try {
        balance = await getSuiFlowWalletBalance(user.walletObjectId);
      } catch (contractError) {
        console.warn(
          "⚠️ Failed to get smart contract balance, falling back to address balance:",
          contractError.message
        );
        const { getBalance } = await import("../services/sui-contracts.js");
        balance = await getBalance(user.suiAddress);
      }
    } else {
      console.log(`🔄 Getting balance for address ${user.suiAddress}`);
      const { getBalance } = await import("../services/sui-contracts.js");
      balance = await getBalance(user.suiAddress);
    }

    res.json({
      success: true,
      data: {
        phone: user.phone,
        fullName: user.fullName,
        suiAddress: user.suiAddress,
        walletObjectId: user.walletObjectId,
        balance: {
          sui: balance,
          formatted: `${balance.toFixed(6)} SUI`,
        },
        walletType: user.walletObjectId ? "smart_contract" : "regular",
        accountStatus: "active",
        failedAttempts: user.failedAttempts,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("❌ Error getting account info:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get account information",
      details: error.message,
    });
  }
});

/**
 * GET /api/user/balance
 * Get user's SUI balance (lightweight endpoint for USSD)
 */
router.get("/balance", verifyToken, checkUserStatus, async (req, res) => {
  try {
    const user = req.userData;

    // Get current balance - use smart contract wallet if available, otherwise use regular address
    let balance;
    if (user.walletObjectId) {
      try {
        balance = await getSuiFlowWalletBalance(user.walletObjectId);
      } catch (contractError) {
        console.warn(
          "⚠️ Failed to get smart contract balance, falling back to address balance:",
          contractError.message
        );
        const { getBalance } = await import("../services/sui-contracts.js");
        balance = await getBalance(user.suiAddress);
      }
    } else {
      const { getBalance } = await import("../services/sui-contracts.js");
      balance = await getBalance(user.suiAddress);
    }

    res.json({
      success: true,
      data: {
        balance: balance,
        formatted: `${balance.toFixed(6)} SUI`,
        suiAddress: user.suiAddress,
      },
    });
  } catch (error) {
    console.error("❌ Error getting balance:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get balance",
      details: error.message,
    });
  }
});

export default router;
