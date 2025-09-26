import express from 'express';
import { rateLimitUSSD } from '../middleware/auth.js';
import { registerUser, getUser, updateUser } from '../services/database.js';
import { createUserWallet, fundNewUserAccount, getBalance, sendSui } from '../services/sui.js';
import { encryptMnemonic, hashPinPhone, verifyPinPhone, decryptMnemonic } from '../utils/encryption.js';
import { USSD_STATES, MAX_FAILED_ATTEMPTS, NEW_USER_FUNDING_AMOUNT } from '../constants.js';

const router = express.Router();

// In-memory session storage for USSD sessions
// In production, consider using Redis or database for persistence
const ussdSessions = new Map();

// Session timeout (10 minutes)
const SESSION_TIMEOUT = 10 * 60 * 1000;

/**
 * Clean expired sessions periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of ussdSessions.entries()) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      ussdSessions.delete(sessionId);
    }
  }
}, 60000); // Clean every minute

/**
 * Get or create USSD session
 */
function getSession(phoneNumber) {
  let session = ussdSessions.get(phoneNumber);
  if (!session) {
    session = {
      phoneNumber,
      state: USSD_STATES.MAIN_MENU,
      data: {},
      lastActivity: Date.now()
    };
    ussdSessions.set(phoneNumber, session);
  } else {
    session.lastActivity = Date.now();
  }
  return session;
}

/**
 * Update session state
 */
function updateSession(phoneNumber, newState, data = {}) {
  const session = getSession(phoneNumber);
  session.state = newState;
  session.data = { ...session.data, ...data };
  session.lastActivity = Date.now();
}

/**
 * Clear session
 */
function clearSession(phoneNumber) {
  ussdSessions.delete(phoneNumber);
}

/**
 * Format SUI amount for display
 */
function formatSuiAmount(amount) {
  if (amount === 0) return '0 SUI';
  if (amount < 0.001) return `${amount.toFixed(6)} SUI`;
  return `${amount.toFixed(3)} SUI`;
}

/**
 * Main USSD webhook handler
 * POST /api/ussd/webhook
 */
router.post('/webhook', rateLimitUSSD, async (req, res) => {
  try {
    const { sessionId, serviceCode, phoneNumber, text } = req.body;
    
    if (!phoneNumber) {
      return res.send('END Error: Phone number not provided');
    }
    
    console.log(`📱 USSD request from ${phoneNumber}: "${text}"`);
    
    const session = getSession(phoneNumber);
    const userInput = text ? text.split('*').pop() : '';
    
    try {
      let response;
      
      // Handle different states
      switch (session.state) {
        case USSD_STATES.MAIN_MENU:
          response = await handleMainMenu(phoneNumber, userInput);
          break;
          
        case USSD_STATES.REGISTER_NAME:
          response = await handleRegisterName(phoneNumber, userInput);
          break;
          
        case USSD_STATES.REGISTER_PIN:
          response = await handleRegisterPin(phoneNumber, userInput);
          break;
          
        case USSD_STATES.REGISTER_CONFIRM_PIN:
          response = await handleRegisterConfirmPin(phoneNumber, userInput);
          break;
          
        case USSD_STATES.SEND_PHONE:
          response = await handleSendPhone(phoneNumber, userInput);
          break;
          
        case USSD_STATES.SEND_AMOUNT:
          response = await handleSendAmount(phoneNumber, userInput);
          break;
          
        case USSD_STATES.SEND_PIN:
          response = await handleSendPin(phoneNumber, userInput);
          break;
          
        case USSD_STATES.BALANCE_PIN:
          response = await handleBalancePin(phoneNumber, userInput);
          break;
          
        default:
          response = await handleMainMenu(phoneNumber, '');
      }
      
      console.log(`📱 USSD response to ${phoneNumber}: ${response}`);
      res.send(response);
    } catch (error) {
      console.error('❌ Error handling USSD request:', error);
      clearSession(phoneNumber);
      res.send('END Sorry, there was an error processing your request. Please try again later.');
    }
  } catch (error) {
    console.error('❌ Error in USSD webhook:', error);
    res.send('END System error. Please try again later.');
  }
});

/**
 * Handle main menu
 */
async function handleMainMenu(phoneNumber, userInput) {
  const user = await getUser(phoneNumber);
  
  if (!userInput || userInput === '') {
    // Show main menu
    if (user) {
      updateSession(phoneNumber, USSD_STATES.MAIN_MENU);
      return 'CON Welcome to SuiFlow\n' +
             `Hello ${user.fullName}\n\n` +
             '1. Send SUI\n' +
             '2. Check Balance\n' +
             '3. Transaction History\n' +
             '0. Exit';
    } else {
      updateSession(phoneNumber, USSD_STATES.MAIN_MENU);
      return 'CON Welcome to SuiFlow\n\n' +
             'You are not registered yet.\n\n' +
             '1. Register\n' +
             '0. Exit';
    }
  }
  
  // Handle menu selection
  if (user) {
    switch (userInput) {
      case '1':
        updateSession(phoneNumber, USSD_STATES.SEND_PHONE);
        return 'CON Send SUI\n\n' +
               'Enter recipient\'s phone number:';
               
      case '2':
        updateSession(phoneNumber, USSD_STATES.BALANCE_PIN);
        return 'CON Check Balance\n\n' +
               'Enter your 4-digit PIN:';
               
      case '3':
        // For USSD, show last 3 transactions
        try {
          const { getUserTransactions } = await import('../services/database.js');
          const transactions = await getUserTransactions(phoneNumber, 3, 0);
          
          if (transactions.length === 0) {
            clearSession(phoneNumber);
            return 'END Transaction History\n\n' +
                   'No transactions found.';
          }
          
          let response = 'END Recent Transactions\n\n';
          transactions.forEach((tx, index) => {
            const type = tx.senderPhone === phoneNumber ? 'Sent' : 'Received';
            const counterparty = tx.senderPhone === phoneNumber ? tx.receiverName : tx.senderName;
            response += `${index + 1}. ${type} ${formatSuiAmount(tx.amount)}\n`;
            response += `   ${type === 'Sent' ? 'To' : 'From'}: ${counterparty}\n`;
            response += `   Status: ${tx.status}\n\n`;
          });
          
          clearSession(phoneNumber);
          return response;
        } catch (error) {
          console.error('Error getting transactions:', error);
          clearSession(phoneNumber);
          return 'END Error getting transaction history.';
        }
        
      case '0':
        clearSession(phoneNumber);
        return 'END Thank you for using SuiFlow!';
        
      default:
        return 'CON Invalid option. Please try again.\n\n' +
               '1. Send SUI\n' +
               '2. Check Balance\n' +
               '3. Transaction History\n' +
               '0. Exit';
    }
  } else {
    // Unregistered user
    switch (userInput) {
      case '1':
        updateSession(phoneNumber, USSD_STATES.REGISTER_NAME);
        return 'CON Register for SuiFlow\n\n' +
               'Enter your full name:';
               
      case '0':
        clearSession(phoneNumber);
        return 'END Thank you for your interest in SuiFlow!';
        
      default:
        return 'CON Invalid option. Please try again.\n\n' +
               '1. Register\n' +
               '0. Exit';
    }
  }
}

/**
 * Handle registration - name input
 */
async function handleRegisterName(phoneNumber, userInput) {
  if (!userInput || userInput.trim().length < 2) {
    return 'CON Register for SuiFlow\n\n' +
           'Please enter a valid name (at least 2 characters):';
  }
  
  const fullName = userInput.trim();
  
  // Validate name (letters and spaces only)
  if (!/^[a-zA-Z\s]+$/.test(fullName)) {
    return 'CON Register for SuiFlow\n\n' +
           'Name can only contain letters and spaces.\n' +
           'Please enter your full name:';
  }
  
  updateSession(phoneNumber, USSD_STATES.REGISTER_PIN, { fullName });
  return 'CON Register for SuiFlow\n\n' +
         `Name: ${fullName}\n\n` +
         'Create a 4-digit PIN:';
}

/**
 * Handle registration - PIN input
 */
async function handleRegisterPin(phoneNumber, userInput) {
  if (!userInput || !/^\d{4}$/.test(userInput)) {
    return 'CON Register for SuiFlow\n\n' +
           'PIN must be exactly 4 digits.\n' +
           'Create a 4-digit PIN:';
  }
  
  const session = getSession(phoneNumber);
  updateSession(phoneNumber, USSD_STATES.REGISTER_CONFIRM_PIN, { pin: userInput });
  
  return 'CON Register for SuiFlow\n\n' +
         'Confirm your 4-digit PIN:';
}

/**
 * Handle registration - PIN confirmation
 */
async function handleRegisterConfirmPin(phoneNumber, userInput) {
  const session = getSession(phoneNumber);
  
  if (!userInput || userInput !== session.data.pin) {
    updateSession(phoneNumber, USSD_STATES.REGISTER_PIN, { fullName: session.data.fullName });
    return 'CON Register for SuiFlow\n\n' +
           'PINs do not match.\n' +
           'Create a 4-digit PIN:';
  }
  
  try {
    const { fullName, pin } = session.data;
    
    // Check if user already exists
    const existingUser = await getUser(phoneNumber);
    if (existingUser) {
      clearSession(phoneNumber);
      return 'END Registration failed.\n\n' +
             'Phone number already registered.';
    }
    
    // Create wallet
    const walletInfo = createUserWallet();
    const encryptedMnemonic = encryptMnemonic(walletInfo.mnemonic, pin);
    const pinHash = hashPinPhone(pin, phoneNumber);
    
    // Register user
    await registerUser({
      phone: phoneNumber,
      fullName,
      suiAddress: walletInfo.address,
      publicKey: walletInfo.publicKey,
      encryptedMnemonic,
      pinHash
    });
    
    // Fund account (don't wait for it to complete)
    fundNewUserAccount(walletInfo.address).catch(error => {
      console.error('Failed to fund new user account:', error);
    });
    
    clearSession(phoneNumber);
    return `END Registration Successful!\n\n` +
           `Welcome ${fullName}!\n` +
           `Your SuiFlow wallet is ready.\n\n` +
           `Address: ${walletInfo.address.slice(0, 10)}...\n\n` +
           `You will receive ${NEW_USER_FUNDING_AMOUNT} SUI for gas fees shortly.`;
  } catch (error) {
    console.error('Registration error:', error);
    clearSession(phoneNumber);
    return 'END Registration failed.\n\n' +
           'Please try again later.';
  }
}

/**
 * Handle send SUI - phone number input
 */
async function handleSendPhone(phoneNumber, userInput) {
  if (!userInput) {
    return 'CON Send SUI\n\n' +
           'Enter recipient\'s phone number:';
  }
  
  // Validate phone number format
  if (!/^\+?[1-9]\d{1,14}$/.test(userInput)) {
    return 'CON Send SUI\n\n' +
           'Invalid phone number format.\n' +
           'Enter recipient\'s phone number:';
  }
  
  if (userInput === phoneNumber) {
    return 'CON Send SUI\n\n' +
           'Cannot send to yourself.\n' +
           'Enter recipient\'s phone number:';
  }
  
  // Check if receiver exists
  try {
    const receiver = await getUser(userInput);
    if (!receiver) {
      return 'CON Send SUI\n\n' +
             'Recipient not found.\n' +
             'Make sure they are registered.\n' +
             'Enter recipient\'s phone number:';
    }
    
    updateSession(phoneNumber, USSD_STATES.SEND_AMOUNT, { 
      receiverPhone: userInput,
      receiverName: receiver.fullName 
    });
    
    return `CON Send SUI\n\n` +
           `To: ${receiver.fullName}\n` +
           `Phone: ${userInput}\n\n` +
           `Enter amount (SUI):`;
  } catch (error) {
    console.error('Error checking receiver:', error);
    return 'CON Send SUI\n\n' +
           'Error checking recipient.\n' +
           'Enter recipient\'s phone number:';
  }
}

/**
 * Handle send SUI - amount input
 */
async function handleSendAmount(phoneNumber, userInput) {
  const session = getSession(phoneNumber);
  
  if (!userInput) {
    return `CON Send SUI\n\n` +
           `To: ${session.data.receiverName}\n\n` +
           `Enter amount (SUI):`;
  }
  
  // Validate amount
  const amount = parseFloat(userInput);
  if (isNaN(amount) || amount <= 0) {
    return `CON Send SUI\n\n` +
           `To: ${session.data.receiverName}\n\n` +
           `Invalid amount.\n` +
           `Enter amount (SUI):`;
  }
  
  if (amount < 0.000001) {
    return `CON Send SUI\n\n` +
           `To: ${session.data.receiverName}\n\n` +
           `Minimum amount is 0.000001 SUI.\n` +
           `Enter amount (SUI):`;
  }
  
  if (amount > 1000000) {
    return `CON Send SUI\n\n` +
           `To: ${session.data.receiverName}\n\n` +
           `Maximum amount is 1,000,000 SUI.\n` +
           `Enter amount (SUI):`;
  }
  
  updateSession(phoneNumber, USSD_STATES.SEND_PIN, { amount });
  
  return `CON Send SUI\n\n` +
         `To: ${session.data.receiverName}\n` +
         `Amount: ${formatSuiAmount(amount)}\n\n` +
         `Enter your 4-digit PIN to confirm:`;
}

/**
 * Handle send SUI - PIN input and transaction execution
 */
async function handleSendPin(phoneNumber, userInput) {
  const session = getSession(phoneNumber);
  
  if (!userInput || !/^\d{4}$/.test(userInput)) {
    return `CON Send SUI\n\n` +
           `To: ${session.data.receiverName}\n` +
           `Amount: ${formatSuiAmount(session.data.amount)}\n\n` +
           `PIN must be 4 digits.\n` +
           `Enter your 4-digit PIN:`;
  }
  
  try {
    const pin = userInput;
    const user = await getUser(phoneNumber);
    
    // Verify PIN
    const isValidPin = verifyPinPhone(pin, phoneNumber, user.pinHash);
    if (!isValidPin) {
      // Increment failed attempts
      const newFailedAttempts = user.failedAttempts + 1;
      await updateUser(phoneNumber, { failedAttempts: newFailedAttempts });
      
      if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
        clearSession(phoneNumber);
        return 'END Account Locked\n\n' +
               'Too many failed PIN attempts.\n' +
               'Please contact support.';
      }
      
      const remainingAttempts = MAX_FAILED_ATTEMPTS - newFailedAttempts;
      return `CON Send SUI\n\n` +
             `Invalid PIN.\n` +
             `${remainingAttempts} attempt(s) remaining.\n\n` +
             `Enter your 4-digit PIN:`;
    }
    
    // Reset failed attempts on successful PIN
    if (user.failedAttempts > 0) {
      await updateUser(phoneNumber, { failedAttempts: 0 });
    }
    
    // Check balance
    const balance = await getBalance(user.suiAddress);
    if (balance < session.data.amount) {
      clearSession(phoneNumber);
      return `END Insufficient Balance\n\n` +
             `You have: ${formatSuiAmount(balance)}\n` +
             `Trying to send: ${formatSuiAmount(session.data.amount)}`;
    }
    
    // Get receiver user
    const receiver = await getUser(session.data.receiverPhone);
    
    // Execute transaction
    const decryptedMnemonic = decryptMnemonic(user.encryptedMnemonic, pin);
    const result = await sendSui(decryptedMnemonic, receiver.suiAddress, session.data.amount);
    
    // Log transaction in database
    const { addTransaction } = await import('../services/database.js');
    await addTransaction({
      senderPhone: phoneNumber,
      receiverPhone: session.data.receiverPhone,
      amount: session.data.amount,
      txHash: result.digest,
      status: result.status === 'success' ? 'success' : 'failed',
      errorMessage: result.error
    });
    
    clearSession(phoneNumber);
    
    if (result.status === 'success') {
      return `END Transaction Successful!\n\n` +
             `Sent: ${formatSuiAmount(session.data.amount)}\n` +
             `To: ${session.data.receiverName}\n\n` +
             `TX Hash: ${result.digest.slice(0, 16)}...`;
    } else {
      return `END Transaction Failed\n\n` +
             `${result.error || 'Unknown error occurred'}`;
    }
  } catch (error) {
    console.error('Error in send transaction:', error);
    clearSession(phoneNumber);
    return 'END Transaction failed.\n\n' +
           'Please try again later.';
  }
}

/**
 * Handle balance check - PIN input
 */
async function handleBalancePin(phoneNumber, userInput) {
  if (!userInput || !/^\d{4}$/.test(userInput)) {
    return 'CON Check Balance\n\n' +
           'PIN must be 4 digits.\n' +
           'Enter your 4-digit PIN:';
  }
  
  try {
    const pin = userInput;
    const user = await getUser(phoneNumber);
    
    // Verify PIN
    const isValidPin = verifyPinPhone(pin, phoneNumber, user.pinHash);
    if (!isValidPin) {
      // Increment failed attempts
      const newFailedAttempts = user.failedAttempts + 1;
      await updateUser(phoneNumber, { failedAttempts: newFailedAttempts });
      
      if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
        clearSession(phoneNumber);
        return 'END Account Locked\n\n' +
               'Too many failed PIN attempts.\n' +
               'Please contact support.';
      }
      
      const remainingAttempts = MAX_FAILED_ATTEMPTS - newFailedAttempts;
      return `CON Check Balance\n\n` +
             `Invalid PIN.\n` +
             `${remainingAttempts} attempt(s) remaining.\n\n` +
             `Enter your 4-digit PIN:`;
    }
    
    // Reset failed attempts on successful PIN
    if (user.failedAttempts > 0) {
      await updateUser(phoneNumber, { failedAttempts: 0 });
    }
    
    // Get balance
    const balance = await getBalance(user.suiAddress);
    
    clearSession(phoneNumber);
    return `END Your SuiFlow Balance\n\n` +
           `${formatSuiAmount(balance)}\n\n` +
           `Address: ${user.suiAddress.slice(0, 16)}...`;
  } catch (error) {
    console.error('Error checking balance:', error);
    clearSession(phoneNumber);
    return 'END Error checking balance.\n\n' +
           'Please try again later.';
  }
}

export default router;