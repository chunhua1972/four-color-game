import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Layers3, RotateCcw } from 'lucide-react';
import { COLOR_NAMES, decodeTile, MELD_NAMES, sortHand, tileLabel } from '@four-colors/game-core';
import type { LegalOption, PlayerCommand, PlayerSnapshot } from '@four-colors/game-core';
import { LocalGateway } from '../features/game/gateway.ts';
import type { PracticeConfig } from '../features/game/gateway.ts';
import { CloudGateway } from '../features/game/cloudGateway.ts';
import { Tile } from '../features/game/components/Tile.tsx';
import { Modal } from '../features/game/components/Modal.tsx';
import { useSelection } from '../features/game/stores/selection.ts';
const phaseText = {
  dealer_opening: '莊家開局',
  await_discard: '等待打牌',
  await_draw: '等待翻牌',
  response_window: '等待進牌判定',
  finished: '本局結束',
  drawn_game: '本局流局',
};
function actionName(o: LegalOption): string {
  const c = o.command;
  if (c.type === 'open_draw') return '公開翻牌';
  if (c.type === 'declare_opening_hu') return '天胡';
  if (c.type === 'discard') return '打出 ' + tileLabel(c.tileId);
  return c.intent.kind === 'pass'
    ? '過'
    : c.intent.kind === 'hu'
      ? `胡・${o.huIfWinning} 胡`
      : `${{ eat: '吃', pong: '碰', kong: '槓' }[c.intent.action]} ${MELD_NAMES[c.intent.meldKind]}`;
}
export function PracticePage() {
  const { gameId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const initialConfig = useRef((location.state as { config?: PracticeConfig } | null)?.config);
  const gateway = useRef<LocalGateway | CloudGateway | null>(null);
  const clockOffset = useRef(0);
  const [connected, setConnected] = useState(true);
  const [snap, setSnap] = useState<PlayerSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'discards' | 'hu' | 'result' | 'danger' | number | null>(
    null,
  );
  const [dangerousOption, setDangerousOption] = useState<LegalOption | null>(null);
  const [now, setNow] = useState(Date.now());
  const { selectedId, select, sort, setSort } = useSelection();
  useEffect(() => {
    if (!gameId && initialConfig.current) navigate('/practice', { replace: true, state: null });
    const gw = gameId ? new CloudGateway(gameId) : new LocalGateway();
    gateway.current = gw;
    let alive = true;
    gw.onError = (message) => {
      if (alive) setError(message);
    };
    if (gw instanceof CloudGateway)
      gw.onConnection = (value) => {
        if (alive) setConnected(value);
      };
    const unsubscribe = gw.subscribe((s) => {
      if (alive) {
        setSnap(s);
        clockOffset.current = s.serverNowMs - Date.now();
        select(null);
      }
    });
    (gw instanceof LocalGateway ? gw.initialize(initialConfig.current) : gw.initialize())
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    const refresh = () => {
      gw.getSnapshot().catch(() => {});
    };
    document.addEventListener('visibilitychange', refresh);
    return () => {
      alive = false;
      unsubscribe();
      document.removeEventListener('visibilitychange', refresh);
      gw.dispose();
      gateway.current = null;
    };
  }, [select, navigate, gameId]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + clockOffset.current), 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (snap?.public.result) setDialog('result');
  }, [snap?.public.gameId, snap?.public.result]);
  async function submit(command: PlayerCommand) {
    if (!snap || busy || !connected) return;
    setBusy(true);
    setError('');
    try {
      await gateway.current!.submitCommand({
        gameId: snap.public.gameId,
        expectedBoardVersion: snap.public.boardVersion,
        idempotencyKey: crypto.randomUUID(),
        command,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '動作失敗');
    } finally {
      setBusy(false);
    }
  }
  async function replay() {
    if (!snap) return;
    if (gameId) {
      const roomId = (location.state as { roomId?: string } | null)?.roomId;
      navigate(roomId ? `/room/${roomId}` : '/lobby');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await (gateway.current as LocalGateway).replay();
      setDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '開局失敗');
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className="empty">
        <span className="loader" />
        <h2>正在整理牌桌…</h2>
      </main>
    );
  if (!snap)
    return (
      <main className="empty">
        <h1>這裡還沒有牌局</h1>
        {error && <p role="alert">{error}</p>}
        <Link className="primary" to="/">
          回大廳開一桌 <ArrowRight size={18} />
        </Link>
      </main>
    );
  const p = snap.public;
  const mine = p.seats[snap.viewerSeat];
  const canDiscard = snap.legalOptions.some((o) => o.command.type === 'discard');
  const selectedOption = snap.legalOptions.find(
    (o) => o.command.type === 'discard' && o.command.tileId === selectedId,
  );
  const reaction = snap.legalOptions.filter((o) => o.command.type !== 'discard');
  const deadline = p.window?.deadlineAtMs ?? p.turnDeadlineAtMs;
  const seconds = deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000));
  const sorted = sortHand(snap.hand, sort);
  const rows = [
    sorted.slice(0, Math.ceil(sorted.length / 2)),
    sorted.slice(Math.ceil(sorted.length / 2)),
  ];
  const status = p.result
    ? p.result.reason === 'win'
      ? `${p.seats[p.result.winnerSeat!].name} 胡牌・${p.result.totalHu} 胡`
      : p.result.reason === 'draw'
        ? '牌庫已空，本局流局'
        : `${p.seats[p.result.penaltySeat!].name} 相公`
    : snap.myResponse
      ? '你的意向已鎖定，等待裁決'
      : p.activeSeat === snap.viewerSeat
        ? canDiscard
          ? '選一張牌，再按「打出」'
          : p.phase === 'await_draw'
            ? '輪到你，請公開翻牌'
            : phaseText[p.phase]
        : phaseText[p.phase];
  return (
    <div className="game-page" data-game-id={p.gameId}>
      <header className="game-header">
        <Link to="/" aria-label="回大廳" className="icon-button">
          <ArrowLeft size={21} />
        </Link>
        <div>
          <h1>四色・十胡仔</h1>
          <span>
            {gameId ? '雲端對戰' : '本地練習'} / {p.rules.seatCount} 席{' '}
            {p.rules.seatCount > 4 ? '・擴充房規' : ''}
          </span>
        </div>
        <Link className="text-link" to="/tutorial">
          房規
        </Link>
        <button className="quiet" onClick={() => setDialog('hu')}>
          明胡 {mine.publicHu}
        </button>
      </header>
      <main className="game-content">
        <div
          className="seat-row"
          style={{ '--seats': p.rules.seatCount - 1 } as React.CSSProperties}
        >
          {p.seats
            .filter((s) => s.seat !== snap.viewerSeat)
            .map((s) => (
              <button
                key={s.seat}
                className={`seat-panel ${p.activeSeat === s.seat ? 'active' : ''}`}
                onClick={() => setDialog(s.seat)}
              >
                <span className="seat-avatar">{s.seat + 1}</span>
                <span className="seat-name">
                  {s.name}
                  {s.seat === p.dealerSeat && <b>莊</b>}
                </span>
                <span>
                  {s.handCount} 張 <i>·</i> {s.publicHu} 明胡
                </span>
                <span className="seat-backs">▰ ▰ ▰ ▰</span>
              </button>
            ))}
        </div>
        <section className="playing-table">
          <div className="table-topline">
            <span>
              <span className="live-dot" />{' '}
              {p.phase === 'response_window' ? '進牌反應窗' : phaseText[p.phase]}
            </span>
            <span>
              牌庫 <strong>{p.wallCount}</strong> 張
            </span>
          </div>
          <div className="offer-area">
            {p.offer ? (
              <>
                <div className="offer-meta">
                  <span>{p.seats[p.offer.originSeat].name}</span>
                  <strong>{p.offer.source === 'discard' ? '打出' : '公開翻出'}</strong>
                </div>
                <Tile id={p.offer.tileId} />
                <span className="offer-time" aria-label={`剩餘 ${seconds} 秒`}>
                  {seconds}
                  <small>秒</small>
                </span>
              </>
            ) : (
              <div className="table-idle">
                <span className="table-seal">十胡</span>
                <p>
                  {p.result
                    ? '牌局已結束'
                    : p.activeSeat === snap.viewerSeat
                      ? '輪到你了'
                      : `${p.seats[p.activeSeat ?? 0].name} 正在${p.phase === 'await_draw' ? '翻牌' : '選牌'}`}
                </p>
              </div>
            )}
          </div>
          <div className="discard-summary">
            <div className="discard-peek">
              {p.discards.slice(-8).map((id) => (
                <Tile key={id} id={id} mini />
              ))}
            </div>
            <button onClick={() => setDialog('discards')}>
              <Layers3 size={15} /> 棄牌 {p.discards.length}
            </button>
          </div>
        </section>
        <section className="my-area">
          <header className="my-heading">
            <div>
              <span className="seat-avatar human">你</span>
              <strong>你的手牌</strong>
              {p.dealerSeat === snap.viewerSeat && <span className="badge">莊家</span>}
              <small>{snap.hand.length} 張</small>
            </div>
            <div className="sort-actions">
              <button aria-pressed={sort === 'color'} onClick={() => setSort('color')}>
                依顏色
              </button>
              <button aria-pressed={sort === 'role'} onClick={() => setSort('role')}>
                依職別
              </button>
            </div>
          </header>
          {mine.melds.length > 0 && (
            <div className="own-melds">
              {mine.melds.map((m) => (
                <button key={m.id} onClick={() => setDialog(snap.viewerSeat)}>
                  {m.tileIds.map((id) => (
                    <Tile key={id} id={id} mini />
                  ))}
                  <span>{m.hu} 胡</span>
                </button>
              ))}
            </div>
          )}
          <div
            className="hand-rack"
            onKeyDown={(e) => {
              if (e.key === 'Escape') select(null);
              if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
                const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
                const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const next =
                  buttons[
                    (i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
                  ];
                next?.focus();
                e.preventDefault();
              }
            }}
          >
            {rows
              .filter((row) => row.length)
              .map((row, i) => (
                <div className="hand-row" key={i}>
                  {row.map((id) => (
                    <Tile
                      key={id}
                      id={id}
                      selected={selectedId === id}
                      disabled={busy || !canDiscard || decodeTile(id).role === 'general'}
                      onClick={() => select(selectedId === id ? null : id)}
                    />
                  ))}
                </div>
              ))}
          </div>
          <p className="hand-caption">將不能打出 · 點牌選取，再按下方按鈕確認</p>
        </section>
      </main>
      <footer className="action-bar">
        {gameId && !connected && <p className="error">正在恢復連線，暫停送出動作…</p>}
        <p role="status" aria-live="polite">
          {status}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          {p.result ? (
            <>
              <button className="primary" onClick={() => setDialog('result')}>
                查看結算
              </button>
              <button className="quiet" onClick={replay} disabled={busy}>
                <RotateCcw size={16} /> {gameId ? '回房間準備' : '再玩一局'}
              </button>
            </>
          ) : canDiscard ? (
            <>
              <button
                className="quiet"
                disabled={selectedId === null || busy}
                onClick={() => select(null)}
              >
                取消
              </button>
              <button
                className="primary"
                disabled={!selectedOption || busy || !connected}
                onClick={() => selectedOption && submit(selectedOption.command)}
              >
                {busy ? '提交中…' : selectedOption ? actionName(selectedOption) : '選一張手牌'}
              </button>
              {reaction
                .filter((o) => o.command.type === 'declare_opening_hu')
                .map((o) => (
                  <button
                    key={o.id}
                    className="primary"
                    disabled={busy || seconds === 0 || !connected}
                    onClick={() => submit(o.command)}
                  >
                    {actionName(o)}
                  </button>
                ))}
            </>
          ) : reaction.length ? (
            reaction.map((o) => (
              <button
                key={o.id}
                className={o.id === 'pass' ? 'quiet' : 'primary'}
                disabled={busy || seconds === 0 || !connected}
                onClick={() => {
                  if (o.terminalConsequence === 'xiang_gong') {
                    setDangerousOption(o);
                    setDialog('danger');
                    return;
                  }
                  void submit(o.command);
                }}
              >
                {actionName(o)}
                {o.terminalConsequence === 'xiang_gong' ? '（相公）' : ''}
                {o.command.type === 'respond' && o.command.intent.kind === 'claim' && (
                  <span className="claim-preview">
                    {o.previewTileIds.map((id) => tileLabel(id)).join('・')}
                  </span>
                )}
              </button>
            ))
          ) : (
            <span className="waiting">{snap.myResponse ? '等待其他席裁決…' : '請稍候…'}</span>
          )}
        </div>
      </footer>
      {dialog === 'danger' && dangerousOption && (
        <Modal title="這個進牌會造成相公" onClose={() => setDialog(null)}>
          <p>進牌後將沒有非將可打，且未完整達 10 胡。若此意向勝出，你會付其他每席 11 分。</p>
          <div className="tile-gallery">
            {dangerousOption.previewTileIds.map((id) => (
              <Tile key={id} id={id} />
            ))}
          </div>
          <div className="actions">
            <button className="quiet" onClick={() => setDialog(null)}>
              重新選擇
            </button>
            <button
              className="primary"
              disabled={busy || seconds === 0}
              onClick={() => {
                void submit(dangerousOption.command);
                setDialog(null);
              }}
            >
              確認送出
            </button>
          </div>
        </Modal>
      )}
      {dialog === 'discards' && (
        <Modal title={`公開棄牌・${p.discards.length} 張`} onClose={() => setDialog(null)}>
          <div className="tile-gallery">
            {p.discards.map((id) => (
              <Tile key={id} id={id} />
            ))}
          </div>
        </Modal>
      )}
      {typeof dialog === 'number' && (
        <Modal title={`${p.seats[dialog].name} 的明組`} onClose={() => setDialog(null)}>
          {p.seats[dialog].melds.length ? (
            p.seats[dialog].melds.map((m) => (
              <div className="meld-detail" key={m.id}>
                <h3>
                  {MELD_NAMES[m.kind]}・{m.hu} 胡
                </h3>
                <div className="tile-gallery">
                  {m.tileIds.map((id) => (
                    <Tile key={id} id={id} />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <p>尚未有明組。</p>
          )}
        </Modal>
      )}
      {dialog === 'hu' && (
        <Modal title="你的胡數參考" onClose={() => setDialog(null)}>
          <p>
            固定明胡：<strong>{mine.publicHu}</strong>
          </p>
          <p>
            {snap.hint.status === 'eligible' || snap.hint.status === 'below_threshold'
              ? `暗手已完整拆組，目前基礎 ${snap.hint.baseHu} 胡。`
              : snap.hint.status === 'deferred'
                ? '正在計算，完整拆組尚未確認。'
                : '暗手尚未完整拆組；明胡達 10 也需要所有手牌合法成組。'}
          </p>
          <p className="muted">
            這是目前手牌的參考。外來最後進張所在組按明組計胡；只有合法胡牌動作才會結算。
          </p>
        </Modal>
      )}
      {dialog === 'result' && p.result && (
        <Modal
          title={
            p.result.reason === 'win'
              ? '本局胡牌'
              : p.result.reason === 'draw'
                ? '本局流局'
                : '本局相公'
          }
          onClose={() => setDialog(null)}
        >
          <div className="result-hero">
            <strong>{p.result.totalHu}</strong>
            <span>總胡數</span>
            <p>
              基礎 {p.result.baseHu} + 花胡 {p.result.flowerHu}
            </p>
          </div>
          {p.result.reason === 'xiang_gong' && (
            <p>進牌後無非將可打，且不足完整 10 胡；相公席付其他每席 11 分。</p>
          )}
          <div className="score-list">
            {p.result.scores.map((s) => (
              <div key={s.seat}>
                <span>{p.seats[s.seat].name}</span>
                <strong className={s.delta > 0 ? 'positive' : ''}>
                  {s.delta > 0 ? '+' : ''}
                  {s.delta} 分
                </strong>
              </div>
            ))}
          </div>
          {p.result.groups.map((g, i) => (
            <div className="partition-row" key={i}>
              <span>
                {MELD_NAMES[g.kind]}
                <small>{g.exposure === 'exposed' ? '明' : '暗'}</small>
              </span>
              <span>
                {g.typeCounts
                  .flatMap((n, t) =>
                    Array<string>(n).fill(
                      `${COLOR_NAMES[decodeTile(t * 4).color]}${tileLabel(t * 4).slice(1)}`,
                    ),
                  )
                  .join(' ')}
              </span>
              <strong>{g.hu} 胡</strong>
            </div>
          ))}
          {p.flowerTileId !== null && <p>點花：{tileLabel(p.flowerTileId)}</p>}
          <button className="primary full" onClick={replay} disabled={busy}>
            {gameId ? '回房間準備' : '再玩一局'} <RotateCcw size={18} />
          </button>
        </Modal>
      )}
    </div>
  );
}
