/// SuiFlow Admin Module
/// This module provides administrative capabilities for the SuiFlow platform.
/// It manages the AdminCap object and provides functions to freeze/unfreeze user wallets.
module contracts::suiflow_admin {
    use contracts::suiflow_wallet::SuiFlowWallet;

    /// AdminCap is a unique capability object that proves administrative authority
    /// Only one instance will ever be created during package publication
    public struct AdminCap has key, store {
        id: sui::object::UID,
    }

    /// Module initializer that runs only once on package publication
    /// Creates and transfers the single AdminCap to the package publisher
    fun init(ctx: &mut sui::tx_context::TxContext) {
        let admin_cap = AdminCap {
            id: sui::object::new(ctx),
        };
        
        sui::transfer::transfer(admin_cap, sui::tx_context::sender(ctx));
    }

    /// Freezes a user's wallet to prevent all operations
    /// Requires possession of the AdminCap as proof of administrative authority
    public fun freeze_user_wallet(_cap: &AdminCap, wallet: &mut SuiFlowWallet) {
        contracts::suiflow_wallet::freeze_wallet(wallet);
    }

    /// Unfreezes a user's wallet to restore normal operations
    /// Requires possession of the AdminCap as proof of administrative authority
    public fun unfreeze_user_wallet(_cap: &AdminCap, wallet: &mut SuiFlowWallet) {
        contracts::suiflow_wallet::unfreeze_wallet(wallet);
    }
}