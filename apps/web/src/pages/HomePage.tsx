import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, Clock3, Users, WifiOff } from 'lucide-react';
import type { Difficulty, SeatCount } from '@four-colors/game-core';
import { Tile } from '../features/game/components/Tile.tsx';
import { LocalGateway } from '../features/game/gateway.ts';
export function HomePage() {
  const [seats, setSeats] = useState<SeatCount>(4);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const navigate = useNavigate();
  const [notice, setNotice] = useState('');
  async function clearSave() {
    const gw = new LocalGateway();
    try {
      await gw.clear();
      setNotice('暫存牌局已清除');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '無法清除暫局');
    } finally {
      gw.dispose();
    }
  }
  return (
    <div className="home-page">
      <header className="site-header">
        <Link className="brand" to="/">
          <span className="brand-stamp">四</span>四色
          <span className="brand-dot">・</span>十胡仔
        </Link>
        <nav aria-label="主選單">
          <Link to="/tutorial">玩法</Link>
          <Link to="/history">紀錄</Link>
          <span className="edition">LOCAL / 01</span>
        </nav>
      </header>
      <main className="home-main">
        <div className="intro">
          <span className="eyebrow">
            <span /> 一桌好牌，隨時開局
          </span>
          <h1>
            四種顏色，
            <br />
            百般<span className="serif-accent">牌趣。</span>
          </h1>
          <p>
            將士象，車馬炮，三色兵。
            <br />
            把熟悉的十胡仔，帶到你的每一個螢幕。
          </p>
          <div className="intro-pills">
            <span>
              <WifiOff size={15} /> 離線練習
            </span>
            <span>
              <Users size={15} /> 2–6 席
            </span>
            <span>繁體中文</span>
          </div>
        </div>
        <div className="hero-table" aria-label="四色牌示意">
          <div className="table-ring" />
          <span className="table-word">十胡</span>
          <div className="hero-hand">
            <Tile id={0} />
            <Tile id={4} />
            <Tile id={8} />
            <Tile id={52} />
            <Tile id={80} />
            <Tile id={108} />
          </div>
          <div className="hero-caption">
            <span>將・士・象</span>
            <span>一局，從這裡開始</span>
          </div>
          <div className="hero-mark">肆色牌局</div>
        </div>
        <section className="setup-panel" aria-labelledby="practice-title">
          <div className="setup-heading">
            <span className="section-number">01</span>
            <div>
              <h2 id="practice-title">開一桌，練練手</h2>
              <p>你與 {seats - 1} 位電腦對手・娛樂積分</p>
            </div>
            <span className="badge">本地練習</span>
          </div>
          <div className="setup-controls">
            <fieldset>
              <legend>一桌幾人</legend>
              <div className="segmented">
                {([2, 3, 4, 5, 6] as SeatCount[]).map((n) => (
                  <button key={n} aria-pressed={seats === n} onClick={() => setSeats(n)}>
                    {n}
                    <small>席</small>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>電腦難度</legend>
              <div className="segmented difficulty">
                <button aria-pressed={difficulty === 'easy'} onClick={() => setDifficulty('easy')}>
                  輕鬆
                </button>
                <button
                  aria-pressed={difficulty === 'normal'}
                  onClick={() => setDifficulty('normal')}
                >
                  一般
                </button>
              </div>
            </fieldset>
            <button
              className="primary start-button"
              onClick={() =>
                navigate('/practice', {
                  state: { config: { seats, difficulty } },
                })
              }
            >
              開始練習 <ArrowRight size={20} />
            </button>
          </div>
          <div className="setup-footnote">
            <span>
              {seats <= 4
                ? '標準產品房規・其他每人 20 張，莊家 21 張'
                : `擴充房規・其他每人 ${seats === 5 ? 16 : 14} 張，莊家多 1 張`}
            </span>
            <Link to="/practice">
              繼續暫存牌局 <ArrowRight size={14} />
            </Link>
          </div>
          <div className="save-tools">
            <button onClick={clearSave}>清除暫局</button>
            {notice && <span role="status">{notice}</span>}
          </div>
        </section>
        <div className="home-links">
          <Link to="/lobby">
            <Users size={23} />
            <div>
              <h3>邀朋友同桌</h3>
              <p>雲端好友房・真人與 AI 同桌</p>
            </div>
            <ArrowRight size={20} />
          </Link>
          <Link to="/tutorial">
            <BookOpen size={23} />
            <div>
              <h3>先認識這副牌</h3>
              <p>牌型、胡數與本桌房規</p>
            </div>
            <ArrowRight size={20} />
          </Link>
          <Link to="/history">
            <Clock3 size={23} />
            <div>
              <h3>回看每一局</h3>
              <p>自己的練習與結算紀錄</p>
            </div>
            <ArrowRight size={20} />
          </Link>
        </div>
      </main>
      <footer className="site-footer">
        <span>112 張牌 · 10 胡起胡 · 一副牌的千變萬化</span>
        <span>本地練習 / 雲端對戰</span>
      </footer>
    </div>
  );
}
