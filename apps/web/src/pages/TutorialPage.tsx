import { Link } from 'react-router-dom';
import { ArrowLeft, FlaskConical } from 'lucide-react';
import { MELD_NAMES, getMeldHu } from '@four-colors/game-core';
import type { MeldKind } from '@four-colors/game-core';
import { Tile } from '../features/game/components/Tile.tsx';
const examples: { kind: MeldKind; ids: number[] }[] = [
  { kind: 'general_single', ids: [0] },
  { kind: 'pair', ids: [4, 5] },
  { kind: 'court', ids: [0, 4, 8] },
  { kind: 'army', ids: [12, 16, 20] },
  { kind: 'soldier_three', ids: [24, 52, 80] },
  { kind: 'soldier_four', ids: [24, 52, 80, 108] },
  { kind: 'triple', ids: [12, 13, 14] },
  { kind: 'quad', ids: [12, 13, 14, 15] },
  { kind: 'general_quad', ids: [0, 1, 2, 3] },
];
export function TutorialPage() {
  return (
    <main className="document-page">
      <Link className="back-link" to="/">
        <ArrowLeft size={18} /> 回大廳
      </Link>
      <span className="eyebrow">HOW TO PLAY</span>
      <h1>認識這副四色牌</h1>
      <p className="lead">
        紅、黃、綠、白，每色將士象車馬炮兵各四張，共 112 張。這桌採本產品的十胡房規。
      </p>
      <section>
        <h2>一局怎麼走</h2>
        <ol className="steps">
          <li>莊家多一張。若沒有完整 10 胡天胡，先打出一張非將牌。</li>
          <li>桌面牌開啟 12 秒反應窗；各席選擇胡、槓、碰、吃或過。</li>
          <li>收齊意向或到期後，按「胡 &gt; 槓 &gt; 碰 &gt; 吃」裁決。同級依來源席順序。</li>
          <li>進牌後再打一張非將；無人進牌，就由來源下一席公開翻牌。</li>
          <li>所有自有牌完整成組，基礎達 10 胡才能胡。最後一張翻牌仍可進牌。</li>
        </ol>
      </section>
      <section>
        <h2>牌型與胡數</h2>
        <div className="pattern-grid">
          {examples.map((e) => (
            <article key={e.kind}>
              <h3>{MELD_NAMES[e.kind]}</h3>
              <div className="tile-gallery">
                {e.ids.map((id) => (
                  <Tile key={id} id={id} mini />
                ))}
              </div>
              <p>
                暗 {getMeldHu(e.kind, 'concealed')} 胡 ／ 明 {getMeldHu(e.kind, 'exposed')} 胡
              </p>
            </article>
          ))}
        </div>
      </section>
      <section className="note">
        <h2>這幾條，先記住</h2>
        <p>
          將不能打出。將三張算三個單將，不能碰；同色兵兩張不是合法對。固定明組不能重拆，最後進張所在組按明組計胡。
        </p>
        <p>
          吃只限打牌者下一席；公開翻牌時，翻者與其下一席可以吃。翻者翻到將時不能過，沒有其他吃法就收單將；其他席合法胡或槓仍有較高順位。
        </p>
        <p>只湊出 10 胡、剩下一張孤兵，也不能胡。花胡只在合法胡牌後加分，不能把 9 胡補到門檻。</p>
      </section>
      <section>
        <h2>人數與積分</h2>
        <p>
          2–4 席其他每人 20 張、莊家 21 張。5 席採 16／17 張，6 席採 14／15
          張，屬本產品擴充房規；都維持 10 胡門檻，平衡仍待真人驗收。
        </p>
        <p>
          每敗方支付 1 + max(0, 總胡 − 10) 分；勝者取得總和。流局全 0 分。進牌後無非將可打且未完整達
          10 胡，判相公，支付其他每席 11 分。積分只供娛樂。
        </p>
      </section>
      <Link className="primary" to="/lab">
        <FlaskConical size={18} /> 到驗牌工坊試試
      </Link>
      <p className="muted">本桌預設依 DEVplan.md；地方規則可能不同，熟手驗收尚待完成。</p>
    </main>
  );
}
