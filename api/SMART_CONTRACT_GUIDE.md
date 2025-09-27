# SuiFlow Smart Contract Integration Guide

This guide explains how to integrate and use the SuiFlow smart contracts with your backend API.

## 🏗️ Architecture Overview

The SuiFlow system now supports two types of wallets:

1. **Regular Wallets**: Basic Sui addresses with coin transfers
2. **Smart Contract Wallets**: SuiFlowWallet objects with enhanced features

### Smart Contract Benefits

- **Internal Transfers**: Direct balance transfers between SuiFlowWallet objects (no intermediate coins)
- **Admin Controls**: Freeze/unfreeze wallets for compliance
- **Gas Efficiency**: Internal transfers use less gas than coin transfers
- **Future Extensibility**: Easy to add new features like spending limits, multi-sig, etc.

## 🚀 Deployment Steps

### 1. Deploy Smart Contracts

```bash
cd contracts
sui move build
sui client publish --gas-budget 100000000
```

Or use the deployment script:

```bash
cd api
npm run deploy-contracts
```

### 2. Configure Backend

After deployment, add the following to your `.env` file:

```bash
# Smart Contract Configuration
CONTRACTS_PACKAGE_ID=0x1234567890abcdef1234567890abcdef12345678
ADMIN_CAP_OBJECT_ID=0x1234567890abcdef1234567890abcdef12345678
```

### 3. Update Database Schema

The database will automatically add the `walletObjectId` column when you start the backend.

### 4. Restart Backend

```bash
npm run dev
```

## 📊 Integration Features

### User Registration

When a new user registers:
1. Creates a regular Sui wallet (keypair)
2. Creates a SuiFlowWallet smart contract object
3. Stores both the address and wallet object ID
4. Funds the user with initial SUI for gas

### Transaction Processing

The system automatically chooses the best transfer method:

- **Internal Transfer**: When both users have smart contract wallets
- **Coin Transfer**: When at least one user has only a regular wallet

### Balance Checking

The system checks balances from smart contract wallets when available, falling back to regular address balances.

## 🔧 API Endpoints

### New Endpoints

#### Admin Wallet Management

```http
POST /api/admin/wallet/freeze
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "phone": "+1234567890"
}
```

```http
POST /api/admin/wallet/unfreeze
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "phone": "+1234567890"
}
```

### Updated Endpoints

#### User Account Info
```http
GET /api/user/accountInfo
Authorization: Bearer <user_token>
```

Now returns:
```json
{
  "success": true,
  "data": {
    "phone": "+1234567890",
    "fullName": "John Doe",
    "suiAddress": "0x123...",
    "walletObjectId": "0x456...",
    "balance": {
      "sui": 1.5,
      "formatted": "1.500000 SUI"
    },
    "walletType": "smart_contract",
    "accountStatus": "active",
    "failedAttempts": 0,
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

## 🔄 Migration

### Existing Users

Existing users will continue to work with regular wallets. Smart contract wallets will be created:

- Automatically on next registration (new users)
- Manually using admin tools (if needed)
- On-demand when users perform certain operations

### Migration Script

```bash
npm run migrate-users
```

This script analyzes existing users and provides migration status.

## 🛠️ Smart Contract Functions

### SuiFlowWallet Module

- `create_wallet()` - Creates a new wallet (returns wallet object)
- `deposit(wallet, coin)` - Deposits SUI into wallet
- `withdraw(wallet, amount)` - Withdraws SUI from wallet
- `internal_transfer(from_wallet, to_wallet, amount)` - Transfers between wallets

### SuiFlowAdmin Module

- `freeze_user_wallet(admin_cap, wallet)` - Freezes a wallet
- `unfreeze_user_wallet(admin_cap, wallet)` - Unfreezes a wallet

## ⚡ Performance Benefits

### Internal Transfers

**Before (Regular Transfer)**:
1. Create transaction
2. Split coins from sender's gas
3. Transfer coin to receiver
4. Receiver gets coin object
5. Gas cost: ~0.001 SUI

**After (Internal Transfer)**:
1. Create transaction
2. Call `internal_transfer` function
3. Direct balance update in smart contracts
4. Gas cost: ~0.0005 SUI (50% less)

### Gas Savings

For a platform with 1000 transactions per day:
- **Regular transfers**: 1 SUI/day in gas
- **Internal transfers**: 0.5 SUI/day in gas
- **Annual savings**: ~182.5 SUI

## 🔒 Security Features

### Wallet Ownership
- Only wallet owners can withdraw or transfer funds
- Smart contract enforces ownership checks

### Freeze Protection
- Frozen wallets cannot perform any operations
- Only admins with `AdminCap` can freeze/unfreeze

### Error Handling
- Clear error codes: `ENotOwner`, `EWalletFrozen`
- Automatic fallback to regular transfers when needed

## 📈 Future Enhancements

The smart contract architecture supports easy additions:

1. **Multi-token Support**: Add other coin types
2. **Spending Limits**: Daily/monthly transaction limits
3. **Multi-signature**: Require multiple approvals
4. **Time Locks**: Delayed withdrawals
5. **Staking Integration**: Earn rewards on idle balances

## 🐛 Troubleshooting

### Contract Not Deployed
```
Error: Sui service or contracts not properly configured
```
**Solution**: Deploy contracts and set `CONTRACTS_PACKAGE_ID`

### Missing Admin Cap
```
Error: Admin service not properly configured
```
**Solution**: Set `ADMIN_CAP_OBJECT_ID` in .env file

### User Without Smart Contract Wallet
Users without smart contract wallets will use regular transfers automatically. This ensures backward compatibility.

### Gas Issues
If transactions fail due to insufficient gas:
1. Check operator balance: `/api/admin/health`
2. Fund operator address if needed
3. Adjust gas budget in contract calls

## 📞 Support

For technical issues:
1. Check contract deployment status
2. Verify environment variables
3. Review transaction logs
4. Test with small amounts first

## 📝 Changelog

### v2.0.0 - Smart Contract Integration
- Added SuiFlowWallet smart contracts
- Implemented internal transfers
- Added admin wallet controls
- Enhanced balance checking
- Backward compatibility maintained