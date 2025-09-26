import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { TRANSACTION_STATUS } from '../constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database file path
const DB_PATH = path.join(__dirname, '../../suiflow.db');

// Initialize SQLite database
const db = new sqlite3.Database(DB_PATH);

/**
 * Initialize the database and create tables if they don't exist
 */
export function initDB() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Users table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          phone TEXT PRIMARY KEY,
          fullName TEXT NOT NULL,
          suiAddress TEXT NOT NULL UNIQUE,
          publicKey TEXT NOT NULL,
          encryptedMnemonic TEXT NOT NULL,
          pinHash TEXT NOT NULL,
          failedAttempts INTEGER DEFAULT 0,
          createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Transactions table
      db.run(`
        CREATE TABLE IF NOT EXISTS transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          senderPhone TEXT NOT NULL,
          receiverPhone TEXT NOT NULL,
          amount REAL NOT NULL,
          txHash TEXT UNIQUE,
          status TEXT NOT NULL DEFAULT 'pending',
          errorMessage TEXT,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (senderPhone) REFERENCES users(phone),
          FOREIGN KEY (receiverPhone) REFERENCES users(phone)
        )
      `);

      // Admins table
      db.run(`
        CREATE TABLE IF NOT EXISTS admins (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fullName TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });
}

/**
 * Register a new user
 * @param {Object} userData - User data
 * @returns {Promise} - Promise that resolves with user data
 */
export function registerUser(userData) {
  return new Promise((resolve, reject) => {
    const { phone, fullName, suiAddress, publicKey, encryptedMnemonic, pinHash } = userData;
    
    const query = `
      INSERT INTO users (phone, fullName, suiAddress, publicKey, encryptedMnemonic, pinHash)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    
    db.run(query, [phone, fullName, suiAddress, publicKey, encryptedMnemonic, pinHash], function(err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          reject(new Error('User with this phone number or Sui address already exists'));
        } else {
          reject(err);
        }
      } else {
        resolve({ phone, fullName, suiAddress, publicKey });
      }
    });
  });
}

/**
 * Get user by phone number
 * @param {string} phone - Phone number
 * @returns {Promise} - Promise that resolves with user data
 */
export function getUser(phone) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT * FROM users WHERE phone = ?
    `;
    
    db.get(query, [phone], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row || null);
      }
    });
  });
}

/**
 * Update user data
 * @param {string} phone - Phone number
 * @param {Object} updateData - Data to update
 * @returns {Promise} - Promise that resolves with success
 */
export function updateUser(phone, updateData) {
  return new Promise((resolve, reject) => {
    const allowedFields = ['failedAttempts', 'pinHash', 'fullName'];
    const fields = Object.keys(updateData).filter(key => allowedFields.includes(key));
    
    if (fields.length === 0) {
      reject(new Error('No valid fields to update'));
      return;
    }
    
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const values = fields.map(field => updateData[field]);
    values.push(phone);
    
    const query = `
      UPDATE users 
      SET ${setClause}, updatedAt = CURRENT_TIMESTAMP 
      WHERE phone = ?
    `;
    
    db.run(query, values, function(err) {
      if (err) {
        reject(err);
      } else if (this.changes === 0) {
        reject(new Error('User not found'));
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * Add a new transaction
 * @param {Object} transactionData - Transaction data
 * @returns {Promise} - Promise that resolves with transaction ID
 */
export function addTransaction(transactionData) {
  return new Promise((resolve, reject) => {
    const { senderPhone, receiverPhone, amount, txHash, status = TRANSACTION_STATUS.PENDING, errorMessage } = transactionData;
    
    const query = `
      INSERT INTO transactions (senderPhone, receiverPhone, amount, txHash, status, errorMessage)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    
    db.run(query, [senderPhone, receiverPhone, amount, txHash, status, errorMessage], function(err) {
      if (err) {
        reject(err);
      } else {
        resolve(this.lastID);
      }
    });
  });
}

/**
 * Get transactions for a user
 * @param {string} phone - Phone number
 * @param {number} limit - Limit number of transactions
 * @param {number} offset - Offset for pagination
 * @returns {Promise} - Promise that resolves with transactions
 */
export function getUserTransactions(phone, limit = 50, offset = 0) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT t.*, 
             s.fullName as senderName,
             r.fullName as receiverName
      FROM transactions t
      LEFT JOIN users s ON t.senderPhone = s.phone
      LEFT JOIN users r ON t.receiverPhone = r.phone
      WHERE t.senderPhone = ? OR t.receiverPhone = ?
      ORDER BY t.timestamp DESC
      LIMIT ? OFFSET ?
    `;
    
    db.all(query, [phone, phone, limit, offset], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows || []);
      }
    });
  });
}

/**
 * Get all users (admin function)
 * @param {number} limit - Limit number of users
 * @param {number} offset - Offset for pagination
 * @returns {Promise} - Promise that resolves with users
 */
export function getUsers(limit = 100, offset = 0) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT phone, fullName, suiAddress, publicKey, failedAttempts, createdAt, updatedAt
      FROM users
      ORDER BY createdAt DESC
      LIMIT ? OFFSET ?
    `;
    
    db.all(query, [limit, offset], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows || []);
      }
    });
  });
}

/**
 * Get all transactions (admin function)
 * @param {number} limit - Limit number of transactions
 * @param {number} offset - Offset for pagination
 * @returns {Promise} - Promise that resolves with transactions
 */
export function getAllTransactions(limit = 100, offset = 0) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT t.*, 
             s.fullName as senderName,
             r.fullName as receiverName
      FROM transactions t
      LEFT JOIN users s ON t.senderPhone = s.phone
      LEFT JOIN users r ON t.receiverPhone = r.phone
      ORDER BY t.timestamp DESC
      LIMIT ? OFFSET ?
    `;
    
    db.all(query, [limit, offset], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows || []);
      }
    });
  });
}

/**
 * Update transaction status
 * @param {number} transactionId - Transaction ID
 * @param {string} status - New status
 * @param {string} txHash - Transaction hash (optional)
 * @param {string} errorMessage - Error message (optional)
 * @returns {Promise} - Promise that resolves with success
 */
export function updateTransaction(transactionId, status, txHash = null, errorMessage = null) {
  return new Promise((resolve, reject) => {
    const query = `
      UPDATE transactions 
      SET status = ?, txHash = ?, errorMessage = ?
      WHERE id = ?
    `;
    
    db.run(query, [status, txHash, errorMessage, transactionId], function(err) {
      if (err) {
        reject(err);
      } else if (this.changes === 0) {
        reject(new Error('Transaction not found'));
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * Register a new admin
 * @param {Object} adminData - Admin data
 * @returns {Promise} - Promise that resolves with admin data
 */
export function registerAdmin(adminData) {
  return new Promise((resolve, reject) => {
    const { fullName, email, password } = adminData;
    
    const query = `
      INSERT INTO admins (fullName, email, password)
      VALUES (?, ?, ?)
    `;
    
    db.run(query, [fullName, email, password], function(err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          reject(new Error('Admin with this email already exists'));
        } else {
          reject(err);
        }
      } else {
        resolve({ id: this.lastID, fullName, email });
      }
    });
  });
}

/**
 * Get admin by email
 * @param {string} email - Email address
 * @returns {Promise} - Promise that resolves with admin data
 */
export function getAdmin(email) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT * FROM admins WHERE email = ?
    `;
    
    db.get(query, [email], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row || null);
      }
    });
  });
}

/**
 * Close database connection
 */
export function closeDB() {
  db.close();
}

// Initialize database on module load
initDB().catch(console.error);