import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  ConnectionProvider,
  WalletProvider,
  useConnection,
  useWallet,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey, Transaction, TransactionInstruction, clusterApiUrl } from '@solana/web3.js';
import {
  Offer,
  PROGRAM_ID,
  explainError,
  fetchOffers,
  formatUnits,
  getMintInfo,
  makeIx,
  parseUnits,
  randomSeed,
  refundIx,
  short,
  takeIxs,
} from './escrow';

type Net = 'localnet' | 'devnet';
const ENDPOINTS: Record<Net, string> = {
  localnet: 'http://127.0.0.1:8899',
  devnet: clusterApiUrl('devnet'),
};
const WALLETS: never[] = []; // Phantom, Solflare, Backpack etc. are auto-detected

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; text: string }
  | { kind: 'ok'; text: string; link: string }
  | { kind: 'error'; text: string };

export default function App() {
  const [net, setNet] = useState<Net>('devnet');
  return (
    <ConnectionProvider endpoint={ENDPOINTS[net]}>
      <WalletProvider wallets={WALLETS} autoConnect>
        <WalletModalProvider>
          <Dashboard net={net} setNet={setNet} />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

function Dashboard({ net, setNet }: { net: Net; setNet: (n: Net) => void }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setOffers(await fetchOffers(connection));
    } catch (e) {
      setStatus({ kind: 'error', text: `Could not load offers: ${explainError(e)}` });
    } finally {
      setLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const explorer = (sig: string) =>
    net === 'devnet'
      ? `https://explorer.solana.com/tx/${sig}?cluster=devnet`
      : `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(ENDPOINTS.localnet)}`;

  async function run(label: string, done: string, build: () => Promise<TransactionInstruction[]>) {
    if (!publicKey) return;
    try {
      setStatus({ kind: 'busy', text: label });
      const tx = new Transaction().add(...(await build()));
      const sig = await sendTransaction(tx, connection);
      const latest = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
      setStatus({ kind: 'ok', text: done, link: explorer(sig) });
      await refresh();
    } catch (e) {
      setStatus({ kind: 'error', text: explainError(e) });
    }
  }

  const make = (f: MakeValues) =>
    run('Waiting for your wallet to approve the offer…', 'Offer created.', async () => {
      const mintA = new PublicKey(f.mintA.trim());
      const mintB = new PublicKey(f.mintB.trim());
      const [a, b] = await Promise.all([getMintInfo(connection, mintA), getMintInfo(connection, mintB)]);
      return [
        makeIx({
          maker: publicKey!,
          mintA,
          mintB,
          seed: BigInt(f.seed),
          amount: parseUnits(f.amount, a.decimals),
          receive: parseUnits(f.receive, b.decimals),
          tokenProgram: a.program,
        }),
      ];
    });

  const take = (o: Offer) =>
    run('Waiting for your wallet to approve the swap…', 'Swap complete. The tokens are in your wallet.', async () =>
      takeIxs(publicKey!, o),
    );

  const refund = (o: Offer) =>
    run('Waiting for your wallet to approve the refund…', 'Offer cancelled. Your tokens are back.', async () => [
      refundIx(o),
    ]);

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>Escrow swap</h1>
          <p className="muted">
            Lock tokens in an offer. Anyone who pays your price takes them; the swap happens in one
            transaction or not at all.
          </p>
        </div>
        <div className="controls">
          <select value={net} onChange={(e) => setNet(e.target.value as Net)} aria-label="Network">
            <option value="localnet">Localnet</option>
            <option value="devnet">Devnet</option>
          </select>
          <WalletMultiButton />
        </div>
      </header>

      <StatusBar status={status} />

      <main className="grid">
        <section className="panel">
          <h2>Make an offer</h2>
          {publicKey ? (
            <MakeForm onSubmit={make} busy={status.kind === 'busy'} />
          ) : (
            <p className="empty">Connect a wallet to create an offer.</p>
          )}
        </section>

        <section className="panel wide">
          <div className="row">
            <h2>Open offers</h2>
            <button className="ghost" onClick={refresh} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {offers.length === 0 && !loading && (
            <p className="empty">
              No open offers on {net} for program <code>{short(PROGRAM_ID)}</code>. Make the first one.
            </p>
          )}
          <div className="slips">
            {offers.map((o) => (
              <Slip
                key={o.address.toBase58()}
                offer={o}
                me={publicKey}
                busy={status.kind === 'busy'}
                onTake={() => take(o)}
                onRefund={() => refund(o)}
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function StatusBar({ status }: { status: Status }) {
  if (status.kind === 'idle') return null;
  return (
    <div className={`status ${status.kind}`} role="status">
      {status.kind === 'busy' && status.text}
      {status.kind === 'error' && status.text}
      {status.kind === 'ok' && (
        <>
          {status.text}{' '}
          <a href={status.link} target="_blank" rel="noreferrer">
            View transaction
          </a>
        </>
      )}
    </div>
  );
}

type MakeValues = { mintA: string; mintB: string; amount: string; receive: string; seed: string };

function MakeForm({ onSubmit, busy }: { onSubmit: (v: MakeValues) => void; busy: boolean }) {
  const [v, setV] = useState<MakeValues>({
    mintA: '',
    mintB: '',
    amount: '',
    receive: '',
    seed: randomSeed(),
  });
  const set = (k: keyof MakeValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV({ ...v, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(v);
    setV({ ...v, seed: randomSeed() });
  };

  return (
    <form onSubmit={submit} className="form">
      <label>
        Token you give (mint address)
        <input required value={v.mintA} onChange={set('mintA')} placeholder="Mint A" spellCheck={false} />
      </label>
      <label>
        Amount you give
        <input required inputMode="decimal" value={v.amount} onChange={set('amount')} placeholder="10" />
      </label>
      <label>
        Token you want (mint address)
        <input required value={v.mintB} onChange={set('mintB')} placeholder="Mint B" spellCheck={false} />
      </label>
      <label>
        Amount you want
        <input required inputMode="decimal" value={v.receive} onChange={set('receive')} placeholder="25" />
      </label>
      <label>
        Offer ID
        <span className="inline">
          <input required inputMode="numeric" pattern="\d+" value={v.seed} onChange={set('seed')} />
          <button type="button" className="ghost" onClick={() => setV({ ...v, seed: randomSeed() })}>
            New
          </button>
        </span>
      </label>
      <button className="primary" disabled={busy}>
        Lock tokens and publish offer
      </button>
    </form>
  );
}

function Slip(props: {
  offer: Offer;
  me: PublicKey | null;
  busy: boolean;
  onTake: () => void;
  onRefund: () => void;
}) {
  const { offer: o, me } = props;
  const mine = me?.equals(o.maker) ?? false;
  return (
    <article className="slip">
      <div className="sides">
        <div className="side">
          <span className="label">Offered</span>
          <strong className="amt">{formatUnits(o.amount, o.infoA.decimals)}</strong>
          <code title={o.mintA.toBase58()}>{short(o.mintA)}</code>
        </div>
        <div className="swap" aria-hidden="true">⇄</div>
        <div className="side">
          <span className="label">Wanted</span>
          <strong className="amt">{formatUnits(o.receive, o.infoB.decimals)}</strong>
          <code title={o.mintB.toBase58()}>{short(o.mintB)}</code>
        </div>
      </div>
      <footer>
        <span className="muted">
          {mine ? 'Your offer' : `Maker ${short(o.maker)}`} · ID {o.seed.toString()}
        </span>
        {mine ? (
          <button className="danger" disabled={props.busy} onClick={props.onRefund}>
            Cancel and refund
          </button>
        ) : (
          <button className="primary" disabled={props.busy || !me} onClick={props.onTake}>
            {me ? 'Pay and take' : 'Connect to take'}
          </button>
        )}
      </footer>
    </article>
  );
}
