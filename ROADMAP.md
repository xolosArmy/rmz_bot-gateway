# Roadmap

## v0.4-alpha — Tonalli Wallet WalletConnect verification

- Bot generates WalletConnect URI.
- Tonalli Wallet connects.
- Bot requests ecash_signAndBroadcastTransaction.
- Tonalli Wallet builds, signs, and broadcasts the verification transaction.
- Bot receives txid.
- Manual /check remains available as fallback.

## v0.4.1 — WalletConnect hardening

- Session timeout handling.
- Better txid validation.
- Optional Chronik confirmation after txid.
- Better Telegram UX for long WC URIs.
