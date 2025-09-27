import express from 'express';
import { createTransactionSchema, getTransactionsSchema } from '../schemas/transaction.js';
import { validateRequest, validateQuery, verifyToken, checkUserStatus } from '../middleware/auth.js';
import { addTransaction, getUserTransactions, getUser, updateUser } from '../services/database.js';
import { internalTransfer, getSuiFlowWalletBalance, sendSui, getBalance, isValidSuiAddress } from '../services/sui-contracts.js';
import { decryptMnemonic, verifyPinPhone } from '../utils/encryption.js';
import { TRANSACTION_STATUS, MAX_FAILED_ATTEMPTS } from '../constants.js';

const router = express.Router();

/**
 * POST /api/transaction/new
 * Create a new SUI transaction
 */
router.post('/new', verifyToken, checkUserStatus, validateRequest(createTransactionSchema), async (req, res) => {
  try {
    const { receiverPhone, amount, pin } = req.body;
    const senderUser = req.userData;
    const senderPhone = senderUser.phone;
    
    // Prevent self-transfers
    if (senderPhone === receiverPhone) {
      return res.status(400).json({
        success: false,
        error: 'Cannot send SUI to yourself'
      });
    }
    
    // Get receiver user data
    const receiverUser = await getUser(receiverPhone);
    if (!receiverUser) {
      return res.status(404).json({
        success: false,
        error: 'Receiver not found. Make sure the phone number is registered with SuiFlow.'
      });
    }
    
    // Verify sender's PIN
    const isValidPin = verifyPinPhone(pin, senderPhone, senderUser.pinHash);
    if (!isValidPin) {
      // Increment failed attempts
      const newFailedAttempts = senderUser.failedAttempts + 1;
      await updateUser(senderPhone, { failedAttempts: newFailedAttempts });
      
      const remainingAttempts = MAX_FAILED_ATTEMPTS - newFailedAttempts;
      
      if (remainingAttempts <= 0) {
        return res.status(423).json({
          success: false,
          error: 'Account has been locked due to multiple failed PIN attempts. Please contact support.'
        });
      }
      
      return res.status(401).json({
        success: false,
        error: `Invalid PIN. ${remainingAttempts} attempt(s) remaining before account lockout.`
      });
    }
    
    // Reset failed attempts on successful PIN verification
    if (senderUser.failedAttempts > 0) {
      await updateUser(senderPhone, { failedAttempts: 0 });
    }
    
    // Check sender's balance - use smart contract wallet if available
    let senderBalance;
    if (senderUser.walletObjectId) {
      console.log(`🔄 Checking balance for SuiFlowWallet ${senderUser.walletObjectId}`);
      try {
        senderBalance = await getSuiFlowWalletBalance(senderUser.walletObjectId);
      } catch (contractError) {
        console.warn('⚠️ Failed to get smart contract balance, falling back to address balance:', contractError.message);
        senderBalance = await getBalance(senderUser.suiAddress);
      }
    } else {
      console.log(`🔄 Checking balance for address ${senderUser.suiAddress}`);
      senderBalance = await getBalance(senderUser.suiAddress);
    }
    
    if (senderBalance < amount) {
      return res.status(400).json({
        success: false,
        error: `Insufficient balance. You have ${senderBalance.toFixed(6)} SUI, but tried to send ${amount} SUI.`
      });
    }
    
    // Create pending transaction record
    let transactionId;
    try {
      transactionId = await addTransaction({
        senderPhone,
        receiverPhone,
        amount,
        txHash: null,
        status: TRANSACTION_STATUS.PENDING
      });
      
      console.log(`🔄 Created pending transaction ${transactionId}: ${amount} SUI from ${senderPhone} to ${receiverPhone}`);
    } catch (dbError) {
      console.error('❌ Error creating transaction record:', dbError);
      return res.status(500).json({
        success: false,
        error: 'Failed to create transaction record'
      });
    }
    
    try {
      // Decrypt sender's mnemonic
      const decryptedMnemonic = decryptMnemonic(senderUser.encryptedMnemonic, pin);
      
      // Choose transfer method based on wallet types
      let result;
      if (senderUser.walletObjectId && receiverUser.walletObjectId) {
        // Both users have smart contract wallets - use internal transfer (more efficient)
        console.log(`🔄 Internal transfer: ${amount} SUI from wallet ${senderUser.walletObjectId} to wallet ${receiverUser.walletObjectId}`);
        result = await internalTransfer(
          senderUser.walletObjectId,
          receiverUser.walletObjectId,
          decryptedMnemonic,
          amount
        );
      } else {
        // At least one user doesn't have smart contract wallet - use regular coin transfer
        console.log(`🔄 Regular transfer: ${amount} SUI from ${senderUser.suiAddress} to ${receiverUser.suiAddress}`);
        result = await sendSui(decryptedMnemonic, receiverUser.suiAddress, amount);
      }
      
      // Clear decrypted mnemonic from memory immediately
      // (JavaScript garbage collection will handle this, but we're being explicit)
      
      if (result.status === 'success') {
        // Update transaction record with success
        await addTransaction({
          senderPhone,
          receiverPhone,
          amount,
          txHash: result.digest,
          status: TRANSACTION_STATUS.SUCCESS
        });
        
        console.log(`✅ Transaction successful: ${result.digest}`);
        
        return res.status(201).json({
          success: true,
          message: 'Transaction completed successfully',
          data: {
            transactionId,
            txHash: result.digest,
            explorerUrl: result.explorerUrl,
            amount,
            senderPhone,
            receiverPhone,
            receiverName: receiverUser.fullName,
            status: 'success'
          }
        });
      } else {
        // Update transaction record with failure
        await addTransaction({
          senderPhone,
          receiverPhone,
          amount,
          txHash: null,
          status: TRANSACTION_STATUS.FAILED,
          errorMessage: result.error
        });
        
        console.log(`❌ Transaction failed: ${result.error}`);
        
        return res.status(400).json({
          success: false,
          error: `Transaction failed: ${result.error}`,
          data: {
            transactionId,
            status: 'failed'
          }
        });
      }
    } catch (transactionError) {
      console.error('❌ Error during SUI transaction:', transactionError);
      
      // Update transaction record with failure
      try {
        await addTransaction({
          senderPhone,
          receiverPhone,
          amount,
          txHash: null,
          status: TRANSACTION_STATUS.FAILED,
          errorMessage: transactionError.message
        });
      } catch (updateError) {
        console.error('❌ Error updating failed transaction:', updateError);
      }
      
      return res.status(500).json({
        success: false,
        error: 'Transaction failed',
        details: transactionError.message,
        data: {
          transactionId,
          status: 'failed'
        }
      });
    }
  } catch (error) {
    console.error('❌ Error creating transaction:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create transaction',
      details: error.message
    });
  }
});

/**
 * GET /api/transaction/history
 * Get user's transaction history
 */
router.get('/history', verifyToken, checkUserStatus, validateQuery(getTransactionsSchema), async (req, res) => {
  try {
    const user = req.userData;
    const { limit, offset } = req.query;
    
    console.log(`🔄 Getting transaction history for ${user.phone}`);
    const transactions = await getUserTransactions(user.phone, limit, offset);
    
    // Format transactions for response
    const formattedTransactions = transactions.map(tx => ({
      id: tx.id,
      type: tx.senderPhone === user.phone ? 'sent' : 'received',
      amount: tx.amount,
      counterparty: tx.senderPhone === user.phone ? {
        phone: tx.receiverPhone,
        name: tx.receiverName
      } : {
        phone: tx.senderPhone,
        name: tx.senderName
      },
      status: tx.status,
      txHash: tx.txHash,
      timestamp: tx.timestamp,
      errorMessage: tx.errorMessage
    }));
    
    res.json({
      success: true,
      data: {
        transactions: formattedTransactions,
        pagination: {
          limit,
          offset,
          total: formattedTransactions.length
        }
      }
    });
  } catch (error) {
    console.error('❌ Error getting transaction history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get transaction history',
      details: error.message
    });
  }
});

/**
 * GET /api/transaction/recent
 * Get user's recent transactions (last 10)
 */
router.get('/recent', verifyToken, checkUserStatus, async (req, res) => {
  try {
    const user = req.userData;
    
    console.log(`🔄 Getting recent transactions for ${user.phone}`);
    const transactions = await getUserTransactions(user.phone, 10, 0);
    
    // Format transactions for response
    const formattedTransactions = transactions.map(tx => ({
      id: tx.id,
      type: tx.senderPhone === user.phone ? 'sent' : 'received',
      amount: tx.amount,
      counterpartyName: tx.senderPhone === user.phone ? tx.receiverName : tx.senderName,
      status: tx.status,
      timestamp: tx.timestamp
    }));
    
    res.json({
      success: true,
      data: {
        transactions: formattedTransactions
      }
    });
  } catch (error) {
    console.error('❌ Error getting recent transactions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get recent transactions',
      details: error.message
    });
  }
});

export default router;