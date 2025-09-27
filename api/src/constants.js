// Application constants
export const PORT = process.env.PORT || 5000;
export const JWT_SECRET = process.env.SECRET_KEY;
export const ENCRYPTION_SALT = process.env.ENCRYPTION_SALT;
export const SUI_NETWORK = process.env.SUI_NETWORK || "testnet";
export const SUI_OPERATOR_MNEMONICS = process.env.SUI_OPERATOR_MNEMONICS;

// Smart Contract constants
export const CONTRACTS_PACKAGE_ID = process.env.CONTRACTS_PACKAGE_ID;
export const ADMIN_CAP_OBJECT_ID = process.env.ADMIN_CAP_OBJECT_ID;

// Transaction status constants
export const TRANSACTION_STATUS = {
  PENDING: "pending",
  SUCCESS: "success",
  FAILED: "failed",
};

// User role constants
export const USER_ROLES = {
  USER: "user",
  ADMIN: "admin",
};

// USSD_STATES removed - no longer needed in stateless implementation

// Funding amount for new users (0.02 SUI)
export const NEW_USER_FUNDING_AMOUNT = 0.02;

// Maximum failed login attempts
export const MAX_FAILED_ATTEMPTS = 3;
