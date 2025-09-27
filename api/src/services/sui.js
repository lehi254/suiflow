import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { fromB64, toB64 } from '@mysten/sui/utils';
import dotenv from 'dotenv';

// Load environment variables first
dotenv.config();

import { SUI_NETWORK, SUI_OPERATOR_MNEMONICS, NEW_USER_FUNDING_AMOUNT } from '../constants.js';

// Initialize Sui client
let suiClient;
let operatorKeypair;

/**
 * Initialize the Sui service
 */
function initSuiService() {
  try {
    console.log('🔄 Initializing Sui service...');
    console.log('DEBUG - SUI_OPERATOR_MNEMONICS env:', process.env.SUI_OPERATOR_MNEMONICS ? 'Set' : 'Not set');
    console.log('DEBUG - SUI_NETWORK env:', process.env.SUI_NETWORK);
    
    // Use environment variables directly
    const suiNetwork = process.env.SUI_NETWORK || 'testnet';
    const operatorMnemonics = process.env.SUI_OPERATOR_MNEMONICS;
    
    // Initialize SuiClient based on network
    const networkUrl = getFullnodeUrl(suiNetwork);
    suiClient = new SuiClient({ url: networkUrl });
    
    // Initialize operator keypair from mnemonics
    if (!operatorMnemonics) {
      throw new Error('SUI_OPERATOR_MNEMONICS not configured');
    }
    
    operatorKeypair = Ed25519Keypair.deriveKeypair(operatorMnemonics);
    
    console.log(`✅ Sui service initialized on ${suiNetwork}`);
    console.log(`📍 Operator address: ${operatorKeypair.getPublicKey().toSuiAddress()}`);
  } catch (error) {
    console.error('❌ Failed to initialize Sui service:', error);
    throw error;
  }
}

/**
 * Create a new user wallet (off-chain key generation)
 * @returns {Object} - Wallet information { address, publicKey, mnemonic }
 */
export function createUserWallet() {
  try {
    // Generate a new Ed25519 keypair
    const keypair = new Ed25519Keypair();
    
    // Extract wallet information
    const publicKey = keypair.getPublicKey();
    const address = publicKey.toSuiAddress();
    
    // Get the secret key (seed) as mnemonic representation
    const secretKey = keypair.getSecretKey();
    const mnemonic = toB64(secretKey);
    
    return {
      address,
      publicKey: publicKey.toBase64(),
      mnemonic
    };
  } catch (error) {
    console.error('❌ Error creating user wallet:', error);
    throw new Error('Failed to create user wallet');
  }
}

/**
 * Fund a new user account with gas for initial transactions
 * @param {string} receiverAddress - The address to fund
 * @returns {string} - Transaction digest
 */
export async function fundNewUserAccount(receiverAddress) {
  try {
    if (!operatorKeypair || !suiClient) {
      throw new Error('Sui service not initialized');
    }
    
    // Convert SUI to MIST (1 SUI = 1,000,000,000 MIST)
    const amountInMist = Math.floor(NEW_USER_FUNDING_AMOUNT * 1_000_000_000);
    
    // Create transaction
    const tx = new Transaction();
    
    // Split coins and transfer to new user
    const [coin] = tx.splitCoins(tx.gas, [amountInMist]);
    tx.transferObjects([coin], receiverAddress);
    
    // Execute transaction
    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: operatorKeypair,
      options: {
        showEffects: true,
        showEvents: true,
      },
    });
    
    if (result.effects?.status?.status !== 'success') {
      throw new Error(`Transaction failed: ${result.effects?.status?.error}`);
    }
    
    console.log(`✅ Funded new user account ${receiverAddress} with ${NEW_USER_FUNDING_AMOUNT} SUI`);
    return result.digest;
  } catch (error) {
    console.error('❌ Error funding new user account:', error);
    throw new Error(`Failed to fund new user account: ${error.message}`);
  }
}

/**
 * Send SUI from one user to another
 * @param {string} senderMnemonic - Sender's mnemonic (base64 encoded secret key)
 * @param {string} receiverAddress - Receiver's Sui address
 * @param {number} amountInSui - Amount to send in SUI
 * @returns {Object} - Transaction result { status, digest, explorerUrl }
 */
export async function sendSui(senderMnemonic, receiverAddress, amountInSui) {
  let senderKeypair = null;
  
  try {
    if (!suiClient) {
      throw new Error('Sui service not initialized');
    }
    
    // Create temporary sender keypair from mnemonic
    const secretKeyBytes = fromB64(senderMnemonic);
    senderKeypair = Ed25519Keypair.fromSecretKey(secretKeyBytes);
    
    const senderAddress = senderKeypair.getPublicKey().toSuiAddress();
    
    // Convert SUI to MIST
    const amountInMist = Math.floor(amountInSui * 1_000_000_000);
    
    // Check sender balance first
    const balance = await getBalance(senderAddress);
    if (balance < amountInSui) {
      throw new Error('Insufficient balance');
    }
    
    // Create transaction
    const tx = new Transaction();
    
    // Split coins and transfer
    const [coin] = tx.splitCoins(tx.gas, [amountInMist]);
    tx.transferObjects([coin], receiverAddress);
    
    // Execute transaction
    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: senderKeypair,
      options: {
        showEffects: true,
        showEvents: true,
      },
    });
    
    if (result.effects?.status?.status !== 'success') {
      throw new Error(`Transaction failed: ${result.effects?.status?.error}`);
    }
    
    // Create explorer URL
    const explorerUrl = `https://suiscan.xyz/${SUI_NETWORK}/tx/${result.digest}`;
    
    console.log(`✅ Transaction successful: ${result.digest}`);
    
    return {
      status: 'success',
      digest: result.digest,
      explorerUrl
    };
  } catch (error) {
    console.error('❌ Error sending SUI:', error);
    
    return {
      status: 'failed',
      digest: null,
      explorerUrl: null,
      error: error.message
    };
  } finally {
    // Clear the temporary keypair from memory for security
    if (senderKeypair) {
      senderKeypair = null;
    }
  }
}

/**
 * Get SUI balance for an address
 * @param {string} address - Sui address
 * @returns {number} - Balance in SUI
 */
export async function getBalance(address) {
  try {
    if (!suiClient) {
      throw new Error('Sui service not initialized');
    }
    
    // Get balance in MIST
    const balanceResponse = await suiClient.getBalance({
      owner: address,
      coinType: '0x2::sui::SUI'
    });
    
    const balanceInMist = parseInt(balanceResponse.totalBalance);
    
    // Convert MIST to SUI
    const balanceInSui = balanceInMist / 1_000_000_000;
    
    return balanceInSui;
  } catch (error) {
    console.error('❌ Error getting balance:', error);
    throw new Error(`Failed to get balance: ${error.message}`);
  }
}

/**
 * Get operator balance (for monitoring)
 * @returns {number} - Operator balance in SUI
 */
export async function getOperatorBalance() {
  try {
    if (!operatorKeypair) {
      throw new Error('Operator keypair not initialized');
    }
    
    const operatorAddress = operatorKeypair.getPublicKey().toSuiAddress();
    return await getBalance(operatorAddress);
  } catch (error) {
    console.error('❌ Error getting operator balance:', error);
    throw error;
  }
}

/**
 * Validate if an address is a valid Sui address
 * @param {string} address - Address to validate
 * @returns {boolean} - Whether the address is valid
 */
export function isValidSuiAddress(address) {
  try {
    // Basic validation - Sui addresses are 66 characters long (including 0x prefix)
    if (!address || typeof address !== 'string') {
      return false;
    }
    
    // Remove 0x prefix if present
    const cleanAddress = address.startsWith('0x') ? address.slice(2) : address;
    
    // Check length (64 hex characters)
    if (cleanAddress.length !== 64) {
      return false;
    }
    
    // Check if all characters are valid hex
    const hexRegex = /^[0-9a-fA-F]+$/;
    return hexRegex.test(cleanAddress);
  } catch (error) {
    return false;
  }
}

/**
 * Get transaction details
 * @param {string} txHash - Transaction hash
 * @returns {Object} - Transaction details
 */
export async function getTransactionDetails(txHash) {
  try {
    if (!suiClient) {
      throw new Error('Sui service not initialized');
    }
    
    const txResult = await suiClient.getTransactionBlock({
      digest: txHash,
      options: {
        showInput: true,
        showEffects: true,
        showEvents: true,
      },
    });
    
    return txResult;
  } catch (error) {
    console.error('❌ Error getting transaction details:', error);
    throw new Error(`Failed to get transaction details: ${error.message}`);
  }
}

/**
 * Initialize the Sui service manually
 */
export function init() {
  return initSuiService();
}

// Initialize the Sui service when the module is imported
// Only if not in import context
if (process.env.NODE_ENV !== 'test') {
  // Don't auto-initialize, let app.js do it
  // initSuiService();
}