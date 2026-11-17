# Solana Token Escrow

A token escrow and swap application built using **Solana, Rust, Anchor, and React**. Users can create token swap offers, lock tokens in a program-controlled vault, complete swaps, or cancel offers and reclaim their deposited tokens.

The project also includes a LiteSVM testing environment for testing Anchor instructions without relying on a live Solana cluster.

## Features

- **Create Escrow Offers:** Specify the token you want to deposit, the amount, and the token and amount you expect in return.
- **Program Derived Address (PDA):** Each escrow is created using a deterministic PDA derived from the maker and offer seed.
- **Token Deposits:** Transfer the offered tokens into an escrow-controlled associated token account.
- **Execute Swaps:** A taker transfers the requested tokens to the maker and receives the escrowed tokens.
- **Cancel and Refund:** The maker can cancel an open offer and recover the deposited tokens.
- **Automatic Account Closure:** Escrow and vault accounts are closed after a successful swap or refund.
- **Wallet Integration:** Connect Solana wallets through the frontend.
- **LiteSVM Testing:** Test program instructions and token transfers in a lightweight local environment.

## Tech Stack

| Layer | Technologies |
|---|---|
| Blockchain | Solana |
| Smart Contracts | Rust, Anchor |
| Token Operations | Anchor SPL, SPL Token |
| Testing | LiteSVM, AnchorLiteSVM |
| Frontend | React, TypeScript, Vite |
| Wallet Integration | Solana Wallet Adapter |
| Solana Client | @solana/web3.js |

## Project Structure

```text
Escrow/
├── frontend/
│   └── src/
│       ├── App.tsx
│       └── escrow/
├── programs/
│   └── anchor_escrow/
│       └── src/
│           ├── instructions/
│           │   ├── make.rs
│           │   ├── take.rs
│           │   └── refund.rs
│           ├── state/
│           ├── errors.rs
│           └── lib.rs
├── tests/
│   └── anchor-litesvm-tests.rs
├── idls/
├── Anchor.toml
├── Cargo.toml
└── README.md
```

## How It Works

### 1. Make an Offer

The maker calls the `make` instruction with:

- A unique offer seed.
- The amount of Token A to deposit.
- The amount of Token B expected in return.

The program:

1. Creates an escrow PDA.
2. Initializes an associated token account controlled by the escrow PDA.
3. Stores the escrow information.
4. Transfers Token A into the vault.

### 2. Take an Offer

A taker calls the `take` instruction.

The program:

1. Validates the escrow account and associated token mints.
2. Transfers the requested Token B from the taker to the maker.
3. Transfers Token A from the escrow vault to the taker.
4. Closes the vault and escrow accounts.

### 3. Refund an Offer

The maker can call the `refund` instruction to cancel an open offer.

The program:

1. Verifies the maker's authority.
2. Transfers the deposited Token A back to the maker.
3. Closes the vault and escrow accounts.

## Escrow PDA Derivation

The escrow PDA is derived using the following seeds:

```rust
[
    b"escrow",
    maker.key().as_ref(),
    seed.to_le_bytes().as_ref()
]
```

The escrow PDA acts as the authority for the vault token account.

## Getting Started

### Prerequisites

Install the following tools:

- Rust
- Solana CLI
- Anchor CLI
- Node.js and npm
- Yarn (if required by your Anchor configuration)

### Clone the Repository

```bash
git clone https://github.com/Rav1Chauhan/Escrow.git
cd Escrow
```

### Build the Anchor Program

```bash
anchor build
```

### Run LiteSVM Tests

```bash
cargo test
```

The tests use the compiled program from:

```text
target/deploy/anchor_escrow.so
```

The existing LiteSVM test covers escrow creation, token deposits, offer execution, token transfers, and account closure.

## Frontend Setup

Navigate to the frontend directory:

```bash
cd frontend
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

The frontend supports:

- Localnet using `http://127.0.0.1:8899`
- Solana Devnet
- Wallet connection
- Creating escrow offers
- Viewing open offers
- Executing swaps
- Cancelling offers and requesting refunds

For local development, ensure the program is deployed to the local validator and that the frontend uses the matching program ID.

## Smart Contract Instructions

| Instruction | Description |
|---|---|
| `make` | Creates an escrow and deposits Token A |
| `take` | Exchanges Token B for the escrowed Token A |
| `refund` | Returns deposited tokens to the maker |

## Testing

The repository uses LiteSVM and AnchorLiteSVM to test the escrow program.

The test demonstrates:

- Initializing a LiteSVM environment.
- Creating funded test accounts.
- Creating token mints and associated token accounts.
- Minting test tokens.
- Building and executing Anchor instructions.
- Verifying token balances.
- Checking that escrow and vault accounts are closed after execution.

Run the tests with:

```bash
anchor build
cargo test
```

## Learning Objectives

This project explores:

- Solana Program Derived Addresses (PDAs).
- Anchor account validation and constraints.
- Cross-Program Invocations (CPIs).
- SPL Token transfers.
- Associated Token Accounts (ATAs).
- PDA-based token account authority.
- Account initialization and closure.
- LiteSVM-based smart contract testing.

## Author

**Ravi Chauhan**

- GitHub: [@Rav1Chauhan](https://github.com/Rav1Chauhan)
- Repository: [Solana Escrow](https://github.com/Rav1Chauhan/Escrow)

---

*Built to explore secure token escrow mechanisms and atomic token swaps on Solana.*
