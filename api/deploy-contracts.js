#!/usr/bin/env node

/**
 * SuiFlow Contract Deployment Script
 * 
 * This script deploys the SuiFlow smart contracts and extracts the package ID
 * and admin capability object ID for use in the backend configuration.
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONTRACTS_DIR = join(__dirname, '../contracts');
const ENV_EXAMPLE_PATH = join(__dirname, '.env.example');

console.log('🚀 SuiFlow Contract Deployment');
console.log('================================');

async function deployContracts() {
  try {
    // Change to contracts directory
    process.chdir(CONTRACTS_DIR);
    
    console.log('📁 Current directory:', process.cwd());
    
    // Build contracts first
    console.log('🔨 Building contracts...');
    execSync('sui move build', { stdio: 'pipe' });
    console.log('✅ Contracts built successfully');
    
    // Deploy contracts
    console.log('🚀 Deploying contracts to Sui network...');
    const deployOutput = execSync('sui client publish --gas-budget 100000000', { 
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    console.log('✅ Deployment successful!');
    console.log('📋 Deployment Output:');
    console.log(deployOutput);
    
    // Extract package ID from deployment output
    const packageIdMatch = deployOutput.match(/Package published at:\s*(0x[a-fA-F0-9]+)/);
    if (!packageIdMatch) {
      throw new Error('Could not find package ID in deployment output');
    }
    const packageId = packageIdMatch[1];
    
    // Extract admin cap object ID from deployment output
    const adminCapMatch = deployOutput.match(/AdminCap.*?0x([a-fA-F0-9]+)/);
    let adminCapObjectId = null;
    if (adminCapMatch) {
      adminCapObjectId = '0x' + adminCapMatch[1];
    } else {
      console.warn('⚠️ Could not automatically extract AdminCap object ID');
      console.log('Please find the AdminCap object ID in the deployment output above');
    }
    
    console.log('');
    console.log('🎉 Deployment Complete!');
    console.log('========================');
    console.log(`📦 Package ID: ${packageId}`);
    if (adminCapObjectId) {
      console.log(`🔐 Admin Cap Object ID: ${adminCapObjectId}`);
    }
    console.log('');
    console.log('📝 Configuration:');
    console.log('Add the following to your .env file:');
    console.log(`CONTRACTS_PACKAGE_ID=${packageId}`);
    if (adminCapObjectId) {
      console.log(`ADMIN_CAP_OBJECT_ID=${adminCapObjectId}`);
    }
    
    // Write deployment info to a file
    const deploymentInfo = {
      timestamp: new Date().toISOString(),
      packageId,
      adminCapObjectId,
      network: process.env.SUI_NETWORK || 'testnet'
    };
    
    const deploymentInfoPath = join(__dirname, 'deployment-info.json');
    fs.writeFileSync(deploymentInfoPath, JSON.stringify(deploymentInfo, null, 2));
    console.log(`💾 Deployment info saved to: ${deploymentInfoPath}`);
    
    return deploymentInfo;
  } catch (error) {
    console.error('❌ Deployment failed:', error.message);
    
    if (error.stdout) {
      console.log('📋 Command output:', error.stdout.toString());
    }
    if (error.stderr) {
      console.error('📋 Error output:', error.stderr.toString());
    }
    
    process.exit(1);
  }
}

// Run deployment
if (import.meta.url === `file://${process.argv[1]}`) {
  deployContracts()
    .then(() => {
      console.log('🎊 All done! Update your .env file with the configuration above.');
    })
    .catch(console.error);
}

export { deployContracts };