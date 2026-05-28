# rmz_bot-gateway

Guardianía RMZ Telegram Bot for xolosArmy Network.

## Configuration

Create a local `.env` file for runtime configuration. Do not commit `.env` or secrets.

```env
TELEGRAM_BOT_TOKEN=
CHRONIK_URL=https://chronik.xolosarmy.xyz
GUARDIANIA_VAULT_ADDRESS=ecash:qzdq0q65fwnt94rlcph5kllj0xcry6e0v58zrgp7a3
ENABLE_AUTO_APPROVAL=false
WC_PROJECT_ID=
```

`WC_PROJECT_ID` enables v0.4-alpha WalletConnect mode. When it is present, `/verify` offers Tonalli Wallet automatic verification with WalletConnect plus the manual `/check` fallback.

If `WC_PROJECT_ID` is missing, the bot does not crash. It runs in manual-only mode and continues to support the existing `/check` verification flow.

## Verification

Tonalli Wallet automates the proof. `/check` protects the fallback. `tonalli-core` keeps verifying the RMZ key.

WalletConnect automation still performs Soft Proof-of-Control by requesting the exact microtransaction to the Guardianía Vault. Strict input-origin verification is planned for v0.3.1 / v0.4.x.
