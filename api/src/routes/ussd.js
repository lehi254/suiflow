import express from "express";
import { rateLimitUSSD } from "../middleware/auth.js";
import {
  addTransaction,
  getUser,
  getUserTransactions,
  registerUser,
  updateUser,
} from "../services/database.js";
import {
  createUserWallet,
  fundNewUserAccount,
  getBalance,
  sendSui,
} from "../services/sui.js";
import {
  decryptMnemonic,
  encryptMnemonic,
  hashPinPhone,
  verifyPinPhone,
} from "../utils/encryption.js";
import { MAX_FAILED_ATTEMPTS, NEW_USER_FUNDING_AMOUNT } from "../constants.js";

const router = express.Router();

// Helper to format SUI amounts for USSD display
const formatSui = (amount) => `${parseFloat(amount).toFixed(4)} SUI`;

/**
 * Main USSD Webhook Handler
 * POST /api/ussd
 * This is a stateless handler that relies on the 'text' parameter.
 */
router.post("/webhook", async (req, res) => {
  const { phoneNumber, text } = req.body;
  let response = "";

  if (!phoneNumber) {
    return res.send("END Invalid request. Phone number is missing.");
  }

  try {
    const user = await getUser(phoneNumber);
    const textParts = text.split("*");

    // =================================================================
    // Main Menu Logic
    // =================================================================
    if (text === "") {
      if (user) {
        response = `CON Welcome back, ${user.fullName}!\n` +
          `1. Send SUI\n` +
          `2. Check Balance\n` +
          `3. Recent Transactions`;
      } else {
        response = `CON Welcome to SuiFlow!\n` +
          `1. Register New Wallet`;
      }
    } // =================================================================
    // Registration Flow (Starts with '1' for an unregistered user)
    // =================================================================
    else if (text.startsWith("1") && !user) {
      // 1. Ask for Full Name
      if (textParts.length === 1) {
        response = `CON Enter your full name:`;
      } // 2. Ask for PIN
      else if (textParts.length === 2) {
        const fullName = textParts[1];
        if (fullName.length < 3) {
          response = `CON Name too short. Please enter your full name:`;
        } else {
          response = `CON Create a 4-digit PIN:`;
        }
      } // 3. Ask for PIN Confirmation
      else if (textParts.length === 3) {
        const pin = textParts[2];
        if (!/^\d{4}$/.test(pin)) {
          response = `CON Invalid PIN. Please enter 4 digits:`;
        } else {
          response = `CON Confirm your 4-digit PIN:`;
        }
      } // 4. Process Registration
      else if (textParts.length === 4) {
        const fullName = textParts[1];
        const pin = textParts[2];
        const confirmPin = textParts[3];

        if (pin !== confirmPin) {
          response =
            `END PINs do not match. Please restart the registration process.`;
        } else {
          const wallet = createUserWallet();
          const encryptedMnemonic = encryptMnemonic(wallet.mnemonic, pin);
          const pinHash = hashPinPhone(pin, phoneNumber);

          await registerUser({
            phone: phoneNumber,
            fullName,
            suiAddress: wallet.address,
            publicKey: wallet.publicKey,
            encryptedMnemonic,
            pinHash,
          });

          // Fund account in the background
          fundNewUserAccount(wallet.address).catch(console.error);

          response =
            `END Welcome, ${fullName}! Your SuiFlow wallet is created.\n` +
            `You will receive ${NEW_USER_FUNDING_AMOUNT} SUI for gas fees shortly.`;
        }
      }
    } // =================================================================
    // Send SUI Flow (Starts with '1' for a registered user)
    // =================================================================
    else if (text.startsWith("1") && user) {
      // 1. Ask for Receiver's Phone
      if (textParts.length === 1) {
        response = `CON Enter the recipient's phone number:`;
      } // 2. Ask for Amount
      else if (textParts.length === 2) {
        const receiverPhone = textParts[1];
        const receiver = await getUser(receiverPhone);
        if (!receiver) {
          response =
            `END The recipient phone number is not registered with SuiFlow.`;
        } else if (receiverPhone === phoneNumber) {
          response =
            `END You cannot send SUI to yourself. Please enter a different recipient.`;
        } else {
          response = `CON Sending to ${receiver.fullName}.\n` +
            `Enter amount in SUI:`;
        }
      } // 3. Ask for PIN
      else if (textParts.length === 3) {
        const amount = parseFloat(textParts[2]);
        if (isNaN(amount) || amount <= 0) {
          response = `CON Invalid amount. Please enter a valid SUI amount:`;
        } else {
          response = `CON Send ${formatSui(amount)}?\n` +
            `Enter your PIN to confirm:`;
        }
      } // 4. Process Transaction
      else if (textParts.length === 4) {
        const receiverPhone = textParts[1];
        const amount = parseFloat(textParts[2]);
        const pin = textParts[3];

        const isValidPin = verifyPinPhone(pin, phoneNumber, user.pinHash);
        if (!isValidPin) {
          response = `END Invalid PIN. Transaction canceled.`;
        } else {
          const balance = await getBalance(user.suiAddress);
          if (balance < amount) {
            response = `END Insufficient balance. You have ${
              formatSui(balance)
            }.`;
          } else {
            const receiver = await getUser(receiverPhone);
            const decryptedMnemonic = decryptMnemonic(
              user.encryptedMnemonic,
              pin,
            );

            // Execute transaction (don't wait for USSD response)
            sendSui(decryptedMnemonic, receiver.suiAddress, amount)
              .then((result) => {
                // Log transaction to DB
                addTransaction({
                  senderPhone: phoneNumber,
                  receiverPhone,
                  amount,
                  txHash: result.digest,
                  status: result.status === "success" ? "success" : "failed",
                  errorMessage: result.error,
                });
                console.log(
                  `Transaction from ${phoneNumber} completed with status: ${result.status}`,
                );
              })
              .catch(console.error);

            response =
              `END Transaction of ${
                formatSui(amount)
              } to ${receiver.fullName} is being processed.\n` +
              `You will receive a confirmation shortly.`;
          }
        }
      }
    } // =================================================================
    // Check Balance Flow (Starts with '2' for a registered user)
    // =================================================================
    else if (text.startsWith("2") && user) {
      // 1. Ask for PIN
      if (textParts.length === 1) {
        response = `CON Enter your PIN to check balance:`;
      } // 2. Process Balance Check
      else if (textParts.length === 2) {
        const pin = textParts[1];
        const isValidPin = verifyPinPhone(pin, phoneNumber, user.pinHash);
        if (!isValidPin) {
          response = `END Invalid PIN.`;
        } else {
          const balance = await getBalance(user.suiAddress);
          response = `END Your balance is:\n${formatSui(balance)}`;
        }
      }
    } // =================================================================
    // Recent Transactions Flow (Starts with '3' for a registered user)
    // =================================================================
    else if (text.startsWith("3") && user) {
      const transactions = await getUserTransactions(phoneNumber, 3, 0);
      if (transactions.length === 0) {
        response = `END You have no recent transactions.`;
      } else {
        let txList = "END Recent Transactions:\n";
        transactions.forEach((tx) => {
          const type = tx.senderPhone === phoneNumber ? "Sent" : "Received";
          const counterparty = type === "Sent"
            ? tx.receiverName
            : tx.senderName;
          txList += `${type} ${formatSui(tx.amount)} ${
            type === "Sent" ? "to" : "from"
          } ${counterparty} - ${tx.status}\n`;
        });
        response = txList;
      }
    } // =================================================================
    // Fallback for invalid input
    // =================================================================
    else {
      response = `END Invalid selection. Please try again.`;
    }

    res.send(response);
  } catch (error) {
    console.error(`[USSD_ERROR] for ${req.body.phoneNumber}:`, error);
    res.send("END An unexpected error occurred. Please try again later.");
  }
});

export default router;
