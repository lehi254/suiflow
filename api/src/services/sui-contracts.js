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

// Smart contract configuration
const CONTRACTS_PACKAGE_ID = process.env.CONTRACTS_PACKAGE_ID;
const ADMIN_CAP_OBJECT_ID = process.env.ADMIN_CAP_OBJECT_ID;

/**
 * Initialize the Sui service
 */
function initSuiService() {
  try {
    console.log('🔄 Initializing Sui service...');
    console.log('DEBUG - SUI_OPERATOR_MNEMONICS env:', process.env.SUI_OPERATOR_MNEMONICS ? 'Set' : 'Not set');
    console.log('DEBUG - SUI_NETWORK env:', process.env.SUI_NETWORK);
    console.log('DEBUG - CONTRACTS_PACKAGE_ID env:', process.env.CONTRACTS_PACKAGE_ID ? 'Set' : 'Not set');
    
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
 * Create a SuiFlowWallet smart contract object for a new user
 * @param {string} userMnemonic - User's mnemonic (base64 encoded secret key)
 * @returns {Object} - { walletObjectId, txHash }
 */
export async function createSuiFlowWallet(userMnemonic) {
  try {
    if (!operatorKeypair || !suiClient || !CONTRACTS_PACKAGE_ID) {
      throw new Error('Sui service or contracts not properly configured');
    }
    
    // Create user keypair from mnemonic
    const secretKeyBytes = fromB64(userMnemonic);
    const userKeypair = Ed25519Keypair.fromSecretKey(secretKeyBytes);
    const userAddress = userKeypair.getPublicKey().toSuiAddress();
    
    // Create transaction
    const tx = new Transaction();
    
    // Call create_wallet function from suiflow_wallet module - it returns the wallet object
    const [wallet] = tx.moveCall({
      target: `${CONTRACTS_PACKAGE_ID}::suiflow_wallet::create_wallet`,
      arguments: []
    });
    
    // Transfer the wallet to the user
    tx.transferObjects([wallet], userAddress);
    
    // Execute transaction with user's keypair (so they own the wallet)
    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: userKeypair,
      options: {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
      },
    });
    
    if (result.effects?.status?.status !== 'success') {
      throw new Error(`Transaction failed: ${result.effects?.status?.error}`);
    }
    
    // Extract the created wallet object ID
    const createdObjects = result.objectChanges?.filter(obj => obj.type === 'created');
    const walletObject = createdObjects?.find(obj => 
      obj.objectType?.includes('suiflow_wallet::SuiFlowWallet')
    );
    
    if (!walletObject) {
      throw new Error('Failed to find created wallet object');
    }
    
    console.log(`✅ Created SuiFlowWallet object: ${walletObject.objectId}`);
    return {
      walletObjectId: walletObject.objectId,
      txHash: result.digest
    };
  } catch (error) {
    console.error('❌ Error creating SuiFlowWallet:', error);
    throw new Error(`Failed to create SuiFlowWallet: ${error.message}`);
  }
}

/**
 * Deposit SUI into a SuiFlowWallet
 * @param {string} walletObjectId - The wallet object ID
 * @param {string} userMnemonic - User's mnemonic
 * @param {number} amountInSui - Amount to deposit in SUI
 * @returns {string} - Transaction digest
 */
export async function depositToWallet(walletObjectId, userMnemonic, amountInSui) {
  try {
    if (!suiClient || !CONTRACTS_PACKAGE_ID) {
      throw new Error('Sui service or contracts not properly configured');
    }
    
    // Create user keypair from mnemonic
    const secretKeyBytes = fromB64(userMnemonic);
    const userKeypair = Ed25519Keypair.fromSecretKey(secretKeyBytes);
    
    // Convert SUI to MIST
    const amountInMist = Math.floor(amountInSui * 1_000_000_000);
    
    // Create transaction
    const tx = new Transaction();
    
    // Split coins for deposit
    const [coin] = tx.splitCoins(tx.gas, [amountInMist]);
    
    // Call deposit function from suiflow_wallet module
    tx.moveCall({
      target: `${CONTRACTS_PACKAGE_ID}::suiflow_wallet::deposit`,
      arguments: [
        tx.object(walletObjectId),
        coin
      ]
    });
    
    // Execute transaction
    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: userKeypair,
      options: {
        showEffects: true,
        showEvents: true,
      },
    });
    
    if (result.effects?.status?.status !== 'success') {
      throw new Error(`Transaction failed: ${result.effects?.status?.error}`);
    }
    
    console.log(`✅ Deposited ${amountInSui} SUI to wallet ${walletObjectId}`);
    return result.digest;
  } catch (error) {
    console.error('❌ Error depositing to wallet:', error);
    throw new Error(`Failed to deposit to wallet: ${error.message}`);
  }
}

/**
 * Transfer SUI between two SuiFlowWallets using internal_transfer
 * @param {string} fromWalletObjectId - Sender's wallet object ID
 * @param {string} toWalletObjectId - Receiver's wallet object ID
 * @param {string} senderMnemonic - Sender's mnemonic
 * @param {number} amountInSui - Amount to transfer in SUI
 * @returns {Object} - Transaction result { status, digest, explorerUrl }
 */
export async function internalTransfer(fromWalletObjectId, toWalletObjectId, senderMnemonic, amountInSui) {
  try {
    if (!suiClient || !CONTRACTS_PACKAGE_ID) {
      throw new Error('Sui service or contracts not properly configured');
    }
    
    // Create sender keypair from mnemonic
    const secretKeyBytes = fromB64(senderMnemonic);
    const senderKeypair = Ed25519Keypair.fromSecretKey(secretKeyBytes);
    
    // Convert SUI to MIST
    const amountInMist = Math.floor(amountInSui * 1_000_000_000);
    
    // Create transaction
    const tx = new Transaction();
    
    // Call internal_transfer function from suiflow_wallet module
    tx.moveCall({
      target: `${CONTRACTS_PACKAGE_ID}::suiflow_wallet::internal_transfer`,
      arguments: [
        tx.object(fromWalletObjectId),
        tx.object(toWalletObjectId),
        tx.pure.u64(amountInMist)
      ]
    });
    
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
    
    console.log(`✅ Internal transfer successful: ${result.digest}`);
    
    return {
      status: 'success',
      digest: result.digest,
      explorerUrl
    };
  } catch (error) {
    console.error('❌ Error in internal transfer:', error);
    
    return {
      status: 'failed',
      digest: null,
      explorerUrl: null,
      error: error.message
    };
  }
}

/**
 * Withdraw SUI from a SuiFlowWallet
 * @param {string} walletObjectId - The wallet object ID
 * @param {string} userMnemonic - User's mnemonic
 * @param {number} amountInSui - Amount to withdraw in SUI
 * @returns {string} - Transaction digest
 */
export async function withdrawFromWallet(walletObjectId, userMnemonic, amountInSui) {
  try {
    if (!suiClient || !CONTRACTS_PACKAGE_ID) {
      throw new Error('Sui service or contracts not properly configured');
    }
    
    // Create user keypair from mnemonic
    const secretKeyBytes = fromB64(userMnemonic);
    const userKeypair = Ed25519Keypair.fromSecretKey(secretKeyBytes);
    
    // Convert SUI to MIST
    const amountInMist = Math.floor(amountInSui * 1_000_000_000);
    
    // Create transaction
    const tx = new Transaction();
    
    // Call withdraw function from suiflow_wallet module
    const [withdrawnCoin] = tx.moveCall({
      target: `${CONTRACTS_PACKAGE_ID}::suiflow_wallet::withdraw`,
      arguments: [
        tx.object(walletObjectId),
        tx.pure.u64(amountInMist)
      ]
    });
    
    // Transfer the withdrawn coin to the user's address
    tx.transferObjects([withdrawnCoin], userKeypair.getPublicKey().toSuiAddress());
    
    // Execute transaction
    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: userKeypair,
      options: {
        showEffects: true,
        showEvents: true,
      },
    });
    
    if (result.effects?.status?.status !== 'success') {
      throw new Error(`Transaction failed: ${result.effects?.status?.error}`);
    }
    
    console.log(`✅ Withdrew ${amountInSui} SUI from wallet ${walletObjectId}`);
    return result.digest;
  } catch (error) {
    console.error('❌ Error withdrawing from wallet:', error);
    throw new Error(`Failed to withdraw from wallet: ${error.message}`);
  }
}

/**
 * Get the balance of a SuiFlowWallet by reading its object
 * @param {string} walletObjectId - The wallet object ID
 * @returns {number} - Balance in SUI
 */
export async function getSuiFlowWalletBalance(walletObjectId) {
  try {
    if (!suiClient) {
      throw new Error('Sui service not initialized');
    }
    
    // Get the wallet object
    const walletObject = await suiClient.getObject({
      id: walletObjectId,
      options: {
        showContent: true,
        showType: true,
      },
    });
    
    if (walletObject.error) {
      throw new Error(`Failed to get wallet object: ${walletObject.error.message}`);
    }
    
    // Extract balance from the wallet object
    const content = walletObject.data?.content;
    if (content?.dataType === 'moveObject') {
      const fields = content.fields;
      const balanceInMist = parseInt(fields.balance || '0');
      const balanceInSui = balanceInMist / 1_000_000_000;
      
      return balanceInSui;
    }
    
    throw new Error('Invalid wallet object format');
  } catch (error) {
    console.error('❌ Error getting SuiFlowWallet balance:', error);
    throw new Error(`Failed to get wallet balance: ${error.message}`);
  }
}

/**
 * Freeze a user's SuiFlowWallet (admin function)
 * @param {string} walletObjectId - The wallet object ID to freeze
 * @returns {string} - Transaction digest
 */
export async function freezeUserWallet(walletObjectId) {
  try {
    if (!operatorKeypair || !suiClient || !CONTRACTS_PACKAGE_ID || !ADMIN_CAP_OBJECT_ID) {
      throw new Error('Admin service not properly configured');
    }
    
    // Create transaction
    const tx = new Transaction();
    
    // Call freeze_user_wallet function from suiflow_admin module
    tx.moveCall({
      target: `${CONTRACTS_PACKAGE_ID}::suiflow_admin::freeze_user_wallet`,
      arguments: [
        tx.object(ADMIN_CAP_OBJECT_ID),
        tx.object(walletObjectId)
      ]
    });
    
    // Execute transaction with operator's keypair (admin)
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
    
    console.log(`✅ Froze wallet ${walletObjectId}`);
    return result.digest;
  } catch (error) {
    console.error('❌ Error freezing wallet:', error);
    throw new Error(`Failed to freeze wallet: ${error.message}`);
  }
}

/**
 * Unfreeze a user's SuiFlowWallet (admin function)
 * @param {string} walletObjectId - The wallet object ID to unfreeze
 * @returns {string} - Transaction digest
 */
export async function unfreezeUserWallet(walletObjectId) {
  try {
    if (!operatorKeypair || !suiClient || !CONTRACTS_PACKAGE_ID || !ADMIN_CAP_OBJECT_ID) {
      throw new Error('Admin service not properly configured');
    }
    
    // Create transaction
    const tx = new Transaction();
    
    // Call unfreeze_user_wallet function from suiflow_admin module
    tx.moveCall({
      target: `${CONTRACTS_PACKAGE_ID}::suiflow_admin::unfreeze_user_wallet`,
      arguments: [
        tx.object(ADMIN_CAP_OBJECT_ID),
        tx.object(walletObjectId)
      ]
    });
    
    // Execute transaction with operator's keypair (admin)
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
    
    console.log(`✅ Unfroze wallet ${walletObjectId}`);
    return result.digest;
  } catch (error) {
    console.error('❌ Error unfreezing wallet:', error);
    throw new Error(`Failed to unfreeze wallet: ${error.message}`);
  }
}

// Keep the legacy functions for backward compatibility
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