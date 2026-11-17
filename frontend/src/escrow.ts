import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token';
import idl from '../../idls/anchor_escrow.json';

// Everything below is derived from idls/anchor_escrow.json, so rebuilding the
// program and copying the fresh IDL keeps the frontend in sync.
const idlAny = idl as any;

export const PROGRAM_ID = new PublicKey(idlAny.address);
const ESCROW_DISC: number[] = idlAny.accounts.find((a: any) => a.name === 'Escrow').discriminator;
// discriminator + seed(8) + maker(32) + mint_a(32) + mint_b(32) + receive(8) + bump(1)
export const ESCROW_SIZE = ESCROW_DISC.length + 8 + 32 + 32 + 32 + 8 + 1;

const disc = (name: string) =>
  Buffer.from(idlAny.instructions.find((i: any) => i.name === name).discriminator);

const u64 = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};

export type MintInfo = { decimals: number; program: PublicKey };

export type Offer = {
  address: PublicKey;
  seed: bigint;
  maker: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
  receive: bigint; // raw units of mint B the maker wants
  amount: bigint; // raw units of mint A currently in the vault
  infoA: MintInfo;
  infoB: MintInfo;
};

const mintCache = new Map<string, MintInfo>();

export async function getMintInfo(conn: Connection, mint: PublicKey): Promise<MintInfo> {
  const key = mint.toBase58();
  const hit = mintCache.get(key);
  if (hit) return hit;
  const acc = await conn.getAccountInfo(mint);
  if (!acc) throw new Error(`Mint ${key} was not found on this network.`);
  const m = await getMint(conn, mint, 'confirmed', acc.owner);
  const info = { decimals: m.decimals, program: acc.owner };
  mintCache.set(key, info);
  return info;
}

export const findEscrow = (maker: PublicKey, seed: bigint) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), maker.toBuffer(), u64(seed)],
    PROGRAM_ID,
  )[0];

const ata = (mint: PublicKey, owner: PublicKey, program: PublicKey) =>
  getAssociatedTokenAddressSync(mint, owner, true, program);

const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({
  pubkey,
  isWritable,
  isSigner,
});

const common = (tokenProgram: PublicKey) => [
  meta(ASSOCIATED_TOKEN_PROGRAM_ID),
  meta(tokenProgram),
  meta(SystemProgram.programId),
];

export function makeIx(p: {
  maker: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
  seed: bigint;
  receive: bigint;
  amount: bigint;
  tokenProgram: PublicKey;
}) {
  const escrow = findEscrow(p.maker, p.seed);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(p.maker, true, true),
      meta(escrow, true),
      meta(p.mintA),
      meta(p.mintB),
      meta(ata(p.mintA, p.maker, p.tokenProgram), true),
      meta(ata(p.mintA, escrow, p.tokenProgram), true),
      ...common(p.tokenProgram),
    ],
    data: Buffer.concat([disc('make'), u64(p.seed), u64(p.receive), u64(p.amount)]),
  });
}

export function takeIxs(taker: PublicKey, o: Offer) {
  const tp = o.infoA.program;
  const takerAtaA = ata(o.mintA, taker, tp);
  const takerAtaB = ata(o.mintB, taker, o.infoB.program);
  const makerAtaB = ata(o.mintB, o.maker, o.infoB.program);
  return [
    // Idempotent: does nothing if the account already exists.
    createAssociatedTokenAccountIdempotentInstruction(taker, takerAtaA, taker, o.mintA, tp),
    createAssociatedTokenAccountIdempotentInstruction(taker, makerAtaB, o.maker, o.mintB, o.infoB.program),
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        meta(taker, true, true),
        meta(o.maker, true),
        meta(o.address, true),
        meta(o.mintA),
        meta(o.mintB),
        meta(ata(o.mintA, o.address, tp), true),
        meta(takerAtaA, true),
        meta(takerAtaB, true),
        meta(makerAtaB, true),
        ...common(tp),
      ],
      data: disc('take'),
    }),
  ];
}

export function refundIx(o: Offer) {
  const tp = o.infoA.program;
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(o.maker, true, true),
      meta(o.address, true),
      meta(o.mintA),
      meta(ata(o.mintA, o.address, tp), true),
      meta(ata(o.mintA, o.maker, tp), true),
      ...common(tp),
    ],
    data: disc('refund'),
  });
}

function decodeEscrow(data: Buffer) {
  if (data.length < ESCROW_SIZE) return null;
  if (!ESCROW_DISC.every((b, i) => data[i] === b)) return null;
  let o = ESCROW_DISC.length;
  const seed = data.readBigUInt64LE(o); o += 8;
  const maker = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const mintA = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const mintB = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const receive = data.readBigUInt64LE(o);
  return { seed, maker, mintA, mintB, receive };
}

export async function fetchOffers(conn: Connection): Promise<Offer[]> {
  const accounts = await conn.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: ESCROW_SIZE }],
  });
  const offers: Offer[] = [];
  for (const { pubkey, account } of accounts) {
    const e = decodeEscrow(account.data as Buffer);
    if (!e) continue;
    const [infoA, infoB] = await Promise.all([
      getMintInfo(conn, e.mintA),
      getMintInfo(conn, e.mintB),
    ]);
    let amount = 0n;
    try {
      const bal = await conn.getTokenAccountBalance(ata(e.mintA, pubkey, infoA.program));
      amount = BigInt(bal.value.amount);
    } catch {
      /* vault missing: show 0 */
    }
    offers.push({ address: pubkey, ...e, amount, infoA, infoB });
  }
  return offers.sort((a, b) => (a.seed < b.seed ? 1 : -1));
}

export function formatUnits(raw: bigint, decimals: number): string {
  const s = raw.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

export function parseUnits(text: string, decimals: number): bigint {
  const t = text.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') throw new Error(`"${text}" is not a valid amount.`);
  const [w, f = ''] = t.split('.');
  if (f.length > decimals) throw new Error(`This token allows at most ${decimals} decimal places.`);
  return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, '0') || '0');
}

export const short = (pk: PublicKey | string) => {
  const s = typeof pk === 'string' ? pk : pk.toBase58();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
};

export const randomSeed = () => {
  const a = new BigUint64Array(1);
  crypto.getRandomValues(a);
  return (a[0] >> 16n).toString(); // keep it readable, still unique in practice
};

// Turns "custom program error: 0x1771" into the message from the IDL.
export function explainError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const logs = (err as { logs?: string[] })?.logs?.join('\n') ?? '';
  const m = (text + '\n' + logs).match(/custom program error: 0x([0-9a-fA-F]+)/);
  if (m) {
    const code = parseInt(m[1], 16);
    const known = idlAny.errors?.find((e: any) => e.code === code);
    if (known) return `${known.msg} (${known.name})`;
  }
  if (/User rejected/i.test(text)) return 'You cancelled the request in your wallet.';
  return text;
}
