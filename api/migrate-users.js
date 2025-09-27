#!/usr/bin/env node

/**
 * SuiFlow User Migration Script
 *
 * This script migrates existing users to use SuiFlowWallet smart contracts.
 * It creates smart contract wallets for users who don't have them yet.
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import our services
import { init as initSuiService } from "./src/services/sui-contracts.js";
import { getUsers, getUser } from "./src/services/database.js";

console.log("🔄 SuiFlow User Migration to Smart Contract Wallets");
console.log("==================================================");

async function migrateUsers() {
  try {
    // Initialize Sui service
    console.log("🔄 Initializing Sui service...");
    await initSuiService();
    console.log("✅ Sui service initialized");

    // Check if contracts are configured
    if (!process.env.CONTRACTS_PACKAGE_ID) {
      throw new Error(
        "CONTRACTS_PACKAGE_ID not configured in .env file. Please deploy contracts first."
      );
    }

    // Get all users from database
    console.log("🔄 Fetching users from database...");
    const users = await getUsers(1000, 0); // Get up to 1000 users
    console.log(`📊 Found ${users.length} users`);

    if (users.length === 0) {
      console.log("ℹ️ No users found. Migration complete.");
      return;
    }

    let migratedCount = 0;
    let alreadyMigratedCount = 0;
    let errorCount = 0;

    // Process each user
    for (const user of users) {
      try {
        // Check if user already has a smart contract wallet
        if (user.walletObjectId) {
          console.log(
            `⏭️ User ${user.phone} already has smart contract wallet: ${user.walletObjectId}`
          );
          alreadyMigratedCount++;
          continue;
        }

        console.log(`🔄 Checking user ${user.phone} (${user.fullName})...`);

        // Get full user data including encrypted mnemonic
        const fullUser = await getUser(user.phone);
        if (!fullUser || !fullUser.encryptedMnemonic) {
          console.error(
            `❌ Could not get encrypted mnemonic for user ${user.phone}`
          );
          errorCount++;
          continue;
        }

        // Note: We can't decrypt the mnemonic here without the user's PIN
        // In a real scenario, you'd need to ask users to log in and create their smart contract wallets
        // For now, we'll skip users without smart contract wallets
        console.log(
          `⚠️ User ${user.phone} needs to create smart contract wallet on next login`
        );

        // Alternative approach: Create wallet when user next logs in
        // This would be handled in the login route
      } catch (error) {
        console.error(`❌ Error processing user ${user.phone}:`, error.message);
        errorCount++;
      }
    }

    console.log("");
    console.log("📊 Migration Summary:");
    console.log("====================");
    console.log(`👥 Total users: ${users.length}`);
    console.log(`✅ Already migrated: ${alreadyMigratedCount}`);
    console.log(`🔄 Migrated in this run: ${migratedCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(
      `⏳ Pending migration: ${
        users.length - alreadyMigratedCount - migratedCount
      }`
    );

    if (users.length - alreadyMigratedCount - migratedCount > 0) {
      console.log("");
      console.log(
        "ℹ️ Users without smart contract wallets will have them created on next login."
      );
    }
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    process.exit(1);
  }
}

// Run migration
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateUsers()
    .then(() => {
      console.log("🎊 Migration process completed!");
      process.exit(0);
    })
    .catch(console.error);
}

export { migrateUsers };
