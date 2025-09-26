# SuiFlow Smart Contracts

This directory contains the Move smart contracts for the **SuiFlow** platform - a USSD-based wallet system that enables users with feature phones to interact with the Sui blockchain through a centralized backend server.

## Overview

SuiFlow bridges the gap between traditional mobile money services and blockchain technology by providing a familiar USSD interface for users while leveraging the security and transparency of the Sui blockchain for transaction processing.

## Architecture

The smart contract system consists of two main modules:

### 1. `suiflow_wallet.move` - Core Wallet Functionality
The primary module that handles all user wallet operations:

- **Wallet Creation**: Creates new wallets for registered users
- **Deposit Operations**: Adds SUI funds to user wallets
- **Withdrawal Operations**: Removes SUI from wallets for cash-outs
- **Internal Transfers**: Enables efficient P2P transfers between SuiFlow users
- **Wallet Security**: Supports freezing/unfreezing wallets for security purposes

#### Key Features:
- **Balance Management**: Each wallet maintains a `Balance<SUI>` for efficient fund handling
- **Owner Verification**: Only wallet owners can withdraw or transfer funds
- **Freeze Protection**: Frozen wallets cannot perform any operations
- **Gas Optimization**: Internal transfers avoid creating intermediate coin objects

### 2. `suiflow_admin.move` - Administrative Controls
Provides administrative capabilities for platform management:

- **Admin Capability**: Uses a unique `AdminCap` object for authorization
- **Wallet Management**: Freeze/unfreeze user wallets as needed
- **Security Controls**: Prevents unauthorized administrative actions

#### Key Features:
- **Single Admin Cap**: Only one `AdminCap` is created during deployment
- **Secure Authorization**: All admin functions require the `AdminCap` as proof
- **Wallet Control**: Can freeze/unfreeze wallets for compliance or security

## Smart Contract Objects

### SuiFlowWallet
```move
public struct SuiFlowWallet has key, store {
    id: UID,
    balance: Balance<SUI>,
    owner_address: address,
    is_frozen: bool,
}
```

### AdminCap
```move
public struct AdminCap has key, store {
    id: UID,
}
```

## Public Functions

### Wallet Operations
- `create_wallet()` - Initialize a new user wallet
- `deposit(wallet, coin)` - Add SUI to a wallet
- `withdraw(wallet, amount)` - Remove SUI from a wallet
- `internal_transfer(from_wallet, to_wallet, amount)` - Transfer between wallets

### Administrative Operations
- `freeze_user_wallet(cap, wallet)` - Freeze a user's wallet
- `unfreeze_user_wallet(cap, wallet)` - Unfreeze a user's wallet

## Error Codes

- `ENotOwner (1)` - Caller is not the wallet owner
- `EWalletFrozen (2)` - Operation attempted on a frozen wallet

## Security Features

1. **Owner Verification**: All sensitive operations verify the caller is the wallet owner
2. **Freeze Protection**: Frozen wallets cannot perform any operations
3. **Admin Authorization**: Administrative functions require possession of the unique `AdminCap`
4. **Balance Safety**: Uses Sui's native `Balance<SUI>` type for secure fund management

## Build Instructions

To build the contracts:

```bash
cd contracts
sui move build
```

## Testing

The contracts include a basic test structure in `tests/contracts_tests.move`. To run tests:

```bash
sui move test
```

## Deployment

The contracts are designed to be deployed as a single package on the Sui blockchain. Upon deployment:

1. The `AdminCap` is automatically created and transferred to the deployer
2. Users can then create wallets and perform transactions
3. The admin can manage user wallets as needed

## Integration with SuiFlow Backend

These smart contracts are designed to work with the SuiFlow USSD backend service, which:

- Manages user registration and phone number mapping
- Handles USSD menu interactions
- Submits blockchain transactions on behalf of users
- Provides real-time balance and transaction updates

## Future Enhancements

Potential improvements for future versions:
- Multi-token support beyond SUI
- Transaction history tracking
- Spending limits and controls
- Integration with external payment providers
- Enhanced administrative features

---

**Note**: This is a prototype implementation designed to demonstrate the core concepts of a USSD-based blockchain wallet system. Production deployment would require additional security audits, testing, and compliance considerations.