import express from "express";
import dotenv from "dotenv";
import cors from "cors";

// Load environment variables first
dotenv.config();

import { PORT } from "./constants.js";
import { errorHandler } from "./middleware/auth.js";

// Import routes
import userRoutes from "./routes/user.js";
import transactionRoutes from "./routes/transaction.js";
import ussdRoutes from "./routes/ussd.js";
import adminRoutes from "./routes/admin.js";

// Load environment variables
// dotenv.config(); // Already loaded above

// Validate required environment variables
const requiredEnvVars = [
  "SECRET_KEY",
  "ENCRYPTION_SALT",
  "SUI_OPERATOR_MNEMONICS",
];
const missingEnvVars = requiredEnvVars.filter((varName) =>
  !process.env[varName]
);

if (missingEnvVars.length > 0) {
  console.error(
    "❌ Missing required environment variables:",
    missingEnvVars.join(", "),
  );
  console.error(
    "Please check your .env file and ensure all required variables are set.",
  );
  console.error("Refer to .env.example for the required format.");
  process.exit(1);
}

// Create Express app
const app = express();

// Middleware
app.use(cors({
  origin: true,
  credentials: true,
}));

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} ${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "SuiFlow API is running",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: "1.0.0",
  });
});

// API routes
app.use("/api/user", userRoutes);
app.use("/api/transaction", transactionRoutes);
app.use("/api/ussd", ussdRoutes);
app.use("/api/admin", adminRoutes);

// Root endpoint with API documentation
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to SuiFlow API",
    description: "USSD-Based Sui Wallet Backend for emerging markets",
    version: "1.0.0",
    endpoints: {
      health: "GET /health",
      user: {
        register: "POST /api/user/new",
        login: "POST /api/user/login",
        accountInfo: "GET /api/user/accountInfo (requires auth)",
        balance: "GET /api/user/balance (requires auth)",
      },
      transaction: {
        create: "POST /api/transaction/new (requires auth)",
        history: "GET /api/transaction/history (requires auth)",
        recent: "GET /api/transaction/recent (requires auth)",
      },
      ussd: {
        webhook: "POST /api/ussd/webhook",
      },
      admin: {
        register: "POST /api/admin/register",
        login: "POST /api/admin/login",
        dashboard: "GET /api/admin/dashboard (requires admin auth)",
        users: "GET /api/admin/users (requires admin auth)",
        transactions: "GET /api/admin/transactions (requires admin auth)",
        userDetails: "GET /api/admin/user/:phone (requires admin auth)",
        systemHealth: "GET /api/admin/system/health (requires admin auth)",
      },
    },
    ussdShortCode: "*384*2005#",
    network: process.env.SUI_NETWORK || "testnet",
  });
});

// Handle 404 errors
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    message: `${req.method} ${req.originalUrl} is not a valid API endpoint`,
    availableEndpoints: [
      "GET /",
      "GET /health",
      "POST /api/user/new",
      "POST /api/user/login",
      "GET /api/user/accountInfo",
      "POST /api/transaction/new",
      "GET /api/transaction/history",
      "POST /api/ussd/webhook",
      "POST /api/admin/login",
      "GET /api/admin/dashboard",
    ],
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Graceful shutdown handling
process.on("SIGTERM", () => {
  console.log("🔄 SIGTERM received, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("🔄 SIGINT received, shutting down gracefully...");
  process.exit(0);
});

// Unhandled promise rejection handling
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  process.exit(1);
});

// Start server
const server = app.listen(PORT, async () => {
  console.log("🚀 SuiFlow API Server Started");
  console.log("================================");
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`🔗 Sui Network: ${process.env.SUI_NETWORK || "testnet"}`);
  console.log(`📱 USSD Code: *384*2005#`);

  // Initialize Sui service after server starts
  try {
    const { init } = await import("./services/sui.js");
    await init();
    console.log("✅ Sui service initialized successfully");
  } catch (error) {
    console.error("❌ Failed to initialize Sui service:", error);
  }

  console.log("================================");
  console.log(`✅ API Documentation: http://localhost:${PORT}`);
  console.log(`💚 Health Check: http://localhost:${PORT}/health`);
  console.log("================================");
});

// Handle server errors
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} is already in use`);
    process.exit(1);
  } else {
    console.error("❌ Server error:", error);
    process.exit(1);
  }
});

export default app;
