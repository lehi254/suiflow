/// SuiFlow Wallet Module
/// This module provides wallet functionality for the SuiFlow USSD-based wallet system.
/// It allows users on feature phones to interact with the Sui blockchain through a central backend server.
module contracts::suiflow_wallet {
    use sui::balance::Balance;
    use sui::coin::Coin;
    use sui::sui::SUI;

    // Error constants for security and logic checks
    const ENotOwner: u64 = 1;
    const EWalletFrozen: u64 = 2;

    /// SuiFlowWallet represents a single user's wallet on the SuiFlow platform
    /// This object is managed by the backend-controlled Sui address
    public struct SuiFlowWallet has key, store {
        id: sui::object::UID,
        balance: Balance<SUI>,
        owner_address: address,
        is_frozen: bool,
    }

    /// Creates a new, empty wallet for a newly registered user
    /// This function is called by the SuiFlow backend to initialize user wallets
    /// Returns the wallet object to enable composable transactions
    public fun create_wallet(ctx: &mut sui::tx_context::TxContext): SuiFlowWallet {
        let wallet = SuiFlowWallet {
            id: sui::object::new(ctx),
            balance: sui::balance::zero(),
            owner_address: sui::tx_context::sender(ctx),
            is_frozen: false,
        };
        
        wallet
    }

    /// Adds SUI funds to a user's wallet
    /// This function accepts a Coin<SUI> and adds its balance to the wallet
    public fun deposit(wallet: &mut SuiFlowWallet, coin: Coin<SUI>) {
        assert!(!wallet.is_frozen, EWalletFrozen);
        
        let coin_balance = sui::coin::into_balance(coin);
        sui::balance::join(&mut wallet.balance, coin_balance);
    }

    /// Removes SUI from the wallet, creating a new coin for cash-outs
    /// Only the wallet owner can withdraw funds
    public fun withdraw(wallet: &mut SuiFlowWallet, amount: u64, ctx: &mut sui::tx_context::TxContext): Coin<SUI> {
        assert!(sui::tx_context::sender(ctx) == wallet.owner_address, ENotOwner);
        assert!(!wallet.is_frozen, EWalletFrozen);
        
        let withdrawn_balance = sui::balance::split(&mut wallet.balance, amount);
        sui::coin::from_balance(withdrawn_balance, ctx)
    }

    /// Transfers SUI between two SuiFlow wallets on-chain
    /// This is the primary P2P transfer function for efficient internal transfers
    public fun internal_transfer(
        from_wallet: &mut SuiFlowWallet, 
        to_wallet: &mut SuiFlowWallet, 
        amount: u64, 
        ctx: &mut sui::tx_context::TxContext
    ) {
        assert!(sui::tx_context::sender(ctx) == from_wallet.owner_address, ENotOwner);
        assert!(!from_wallet.is_frozen, EWalletFrozen);
        assert!(!to_wallet.is_frozen, EWalletFrozen);
        
        let transfer_balance = sui::balance::split(&mut from_wallet.balance, amount);
        sui::balance::join(&mut to_wallet.balance, transfer_balance);
    }

    /// Freezes a wallet to prevent all operations
    /// This is an internal function called only by the suiflow_admin module
    public fun freeze_wallet(wallet: &mut SuiFlowWallet) {
        wallet.is_frozen = true;
    }

    /// Unfreezes a wallet to restore normal operations
    /// This is an internal function called only by the suiflow_admin module
    public fun unfreeze_wallet(wallet: &mut SuiFlowWallet) {
        wallet.is_frozen = false;
    }
}
