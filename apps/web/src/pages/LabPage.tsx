import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  createDeck,
  decodeTile,
  evaluateHu,
  makeRuleConfig,
  MELD_NAMES,
  tileLabel,
} from '@four-colors/game-core';
import type { HuEvaluation, Meld } from '@four-colors/game-core';
import { Tile } from '../features/game/components/Tile.tsx';
export function LabPage() {
  const [hand, setHand] = useState<number[]>([12, 13, 14, 15, 28, 56]);
  const [incoming, setIncoming] = useState<number | null>(null);
  const [mode, setMode] = useState<'hand' | 'offer'>('hand');
  const [fixed, setFixed] = useState(false);
  const [result, setResult] = useState<HuEvaluation | null>(null);
  const [error, setError] = useState('');
  const meld: Meld = {
    id: 'lab',
    ownerSeat: 0,
    kind: 'quad',
    tileIds: [12, 13, 14, 15],
    exposure: 'exposed',
    claimedOfferId: 'fixture',
    sourceSeat: 1,
    hu: 6,
  };
  function add(type: number) {
    setResult(null);
    setError('');
    const unavailable = new Set([
      ...hand,
      ...(incoming === null ? [] : [incoming]),
      ...(fixed ? meld.tileIds : []),
    ]);
    const id = createDeck().find((id) => decodeTile(id).typeId === type && !unavailable.has(id));
    if (id === undefined) {
      setError('同型牌最多四張');
      return;
    }
    if (mode === 'offer') setIncoming(id);
    else if (hand.length < 21) setHand([...hand, id]);
    else setError('工坊暗手上限 21 張');
  }
  function solve() {
    try {
      setResult(evaluateHu(hand, incoming, fixed ? [meld] : [], makeRuleConfig(4)));
    } catch (e) {
      setError(e instanceof Error ? e.message : '無法解牌');
    }
  }
  return (
    <main className="document-page">
      <Link className="back-link" to="/tutorial">
        <ArrowLeft size={18} /> 回玩法
      </Link>
      <span className="eyebrow">RULE LAB</span>
      <h1>驗牌工坊</h1>
      <p className="lead">選暗手、固定明槓與最後進張，核對完整拆組和胡數。工坊採四席預設房規。</p>
      <div className="lab-controls">
        <button
          className="quiet"
          onClick={() => {
            setHand([12, 13, 14, 15, 28, 56]);
            setIncoming(null);
            setFixed(false);
            setResult(null);
          }}
        >
          載入 10 胡基線
        </button>
        <button
          className="quiet"
          onClick={() => {
            setHand([28, 56]);
            setIncoming(null);
            setFixed(true);
            setResult(null);
          }}
        >
          載入明槓反例
        </button>
        <button
          className="quiet"
          onClick={() => {
            setHand([]);
            setIncoming(null);
            setFixed(false);
            setResult(null);
          }}
        >
          清空
        </button>
      </div>
      <div className="segmented lab-mode">
        <button aria-pressed={mode === 'hand'} onClick={() => setMode('hand')}>
          加入暗手
        </button>
        <button aria-pressed={mode === 'offer'} onClick={() => setMode('offer')}>
          設定最後進張
        </button>
      </div>
      <div className="catalog">
        {Array.from({ length: 28 }, (_, type) => (
          <Tile key={type} id={type * 4} onClick={() => add(type)} />
        ))}
      </div>
      <h2>暗手（點擊移除）</h2>
      <div className="tile-gallery">
        {hand.map((id) => (
          <Tile
            key={id}
            id={id}
            onClick={() => {
              setHand(hand.filter((x) => x !== id));
              setResult(null);
            }}
          />
        ))}
      </div>
      {fixed && (
        <p>
          固定明槓：紅車 × 4（6 胡，不可重拆）{' '}
          <button
            onClick={() => {
              setFixed(false);
              setResult(null);
            }}
          >
            移除
          </button>
        </p>
      )}
      <p>
        最後進張：{incoming === null ? '無（全暗）' : tileLabel(incoming)}{' '}
        {incoming !== null && (
          <button
            onClick={() => {
              setIncoming(null);
              setResult(null);
            }}
          >
            移除
          </button>
        )}
      </p>
      <button className="primary" onClick={solve}>
        計算最佳完整拆組
      </button>
      {error && <p role="alert">{error}</p>}
      {result && (
        <section className="note" role="status">
          <h2>
            {result.status === 'eligible'
              ? `可以胡・${result.baseHu} 胡`
              : result.status === 'below_threshold'
                ? `完整但未達門檻・${result.baseHu} 胡`
                : result.status === 'deferred'
                  ? '運算延後，不能視為無法胡牌'
                  : '未完整，尚有牌無法成組'}
          </h2>
          {'groups' in result &&
            result.groups.map((g, i) => (
              <p key={i}>
                {MELD_NAMES[g.kind]}・{g.exposure === 'exposed' ? '明' : '暗'}・{g.hu} 胡（
                {g.typeCounts
                  .flatMap((count, t) => Array<string>(count).fill(tileLabel(t * 4)))
                  .join(' ')}
                ）
              </p>
            ))}
        </section>
      )}
    </main>
  );
}
