// Application constants
export const PORT = process.env.PORT || 5000;
export const JWT_SECRET = process.env.SECRET_KEY;
export const ENCRYPTION_SALT = process.env.ENCRYPTION_SALT;
export const SUI_NETWORK = process.env.SUI_NETWORK || 'testnet';
export const SUI_OPERATOR_MNEMONICS = process.env.SUI_OPERATOR_MNEMONICS;

// Transaction status constants
export const TRANSACTION_STATUS = {
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed'
};

// User role constants
export const USER_ROLES = {
  USER: 'user',
  ADMIN: 'admin'
};

// USSD session constants
export const USSD_STATES = {
  MAIN_MENU: 'main_menu',
  REGISTER_NAME: 'register_name',
  REGISTER_PIN: 'register_pin',
  REGISTER_CONFIRM_PIN: 'register_confirm_pin',
  SEND_PHONE: 'send_phone',
  SEND_AMOUNT: 'send_amount',
  SEND_PIN: 'send_pin',
  BALANCE_PIN: 'balance_pin'
};

// Funding amount for new users (0.02 SUI)
export const NEW_USER_FUNDING_AMOUNT = 0.02;

// Maximum failed login attempts
export const MAX_FAILED_ATTEMPTS = 3;