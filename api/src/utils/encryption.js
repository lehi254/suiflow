import CryptoJS from 'crypto-js';
import { ENCRYPTION_SALT } from '../constants.js';

/**
 * Encrypts a Sui mnemonic phrase using AES encryption
 * @param {string} mnemonic - The mnemonic phrase to encrypt
 * @param {string} pin - User's PIN for deriving encryption key
 * @returns {string} - Encrypted mnemonic
 */
export function encryptMnemonic(mnemonic, pin) {
  if (!mnemonic || !pin) {
    throw new Error('Mnemonic and PIN are required for encryption');
  }

  // Derive key from PIN and salt using PBKDF2
  const key = CryptoJS.PBKDF2(pin, ENCRYPTION_SALT, {
    keySize: 256 / 32, // 256 bits
    iterations: 10000
  });

  // Encrypt the mnemonic using AES
  const encrypted = CryptoJS.AES.encrypt(mnemonic, key.toString()).toString();
  
  return encrypted;
}

/**
 * Decrypts a Sui mnemonic phrase using AES decryption
 * @param {string} encryptedMnemonic - The encrypted mnemonic phrase
 * @param {string} pin - User's PIN for deriving decryption key
 * @returns {string} - Decrypted mnemonic
 */
export function decryptMnemonic(encryptedMnemonic, pin) {
  if (!encryptedMnemonic || !pin) {
    throw new Error('Encrypted mnemonic and PIN are required for decryption');
  }

  try {
    // Derive key from PIN and salt using PBKDF2
    const key = CryptoJS.PBKDF2(pin, ENCRYPTION_SALT, {
      keySize: 256 / 32, // 256 bits
      iterations: 10000
    });

    // Decrypt the mnemonic using AES
    const decrypted = CryptoJS.AES.decrypt(encryptedMnemonic, key.toString());
    const mnemonic = decrypted.toString(CryptoJS.enc.Utf8);
    
    if (!mnemonic) {
      throw new Error('Invalid PIN or corrupted data');
    }
    
    return mnemonic;
  } catch (error) {
    throw new Error('Failed to decrypt mnemonic: Invalid PIN or corrupted data');
  }
}

/**
 * Creates a secure, salted hash of a user's PIN and phone number using PBKDF2
 * @param {string} pin - User's PIN
 * @param {string} phone - User's phone number
 * @returns {string} - Hashed PIN with phone
 */
export function hashPinPhone(pin, phone) {
  if (!pin || !phone) {
    throw new Error('PIN and phone number are required for hashing');
  }

  // Combine PIN and phone for additional security
  const combined = `${pin}:${phone}`;
  
  // Create hash using PBKDF2 with salt
  const hash = CryptoJS.PBKDF2(combined, ENCRYPTION_SALT, {
    keySize: 512 / 32, // 512 bits
    iterations: 100000 // Higher iterations for password hashing
  }).toString();

  return hash;
}

/**
 * Verifies a submitted PIN against the stored hash
 * @param {string} submittedPin - PIN submitted by user
 * @param {string} submittedPhone - Phone number submitted by user
 * @param {string} storedHash - Hash stored in database
 * @returns {boolean} - Whether the PIN is valid
 */
export function verifyPinPhone(submittedPin, submittedPhone, storedHash) {
  if (!submittedPin || !submittedPhone || !storedHash) {
    return false;
  }

  try {
    // Hash the submitted PIN and phone
    const submittedHash = hashPinPhone(submittedPin, submittedPhone);
    
    // Compare with stored hash
    return submittedHash === storedHash;
  } catch (error) {
    return false;
  }
}

/**
 * Generates a random salt for additional security (if needed)
 * @param {number} length - Length of the salt in bytes
 * @returns {string} - Random salt
 */
export function generateSalt(length = 32) {
  return CryptoJS.lib.WordArray.random(length).toString();
}