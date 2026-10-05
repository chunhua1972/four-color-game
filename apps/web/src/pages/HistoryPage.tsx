import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { readHistory } from '../features/game/history.ts';
export function HistoryPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['local-history'],
    queryFn: readHistory,
  });
  return (
    <main className="document-page">
      <Link className="back-link" to="/">
        <ArrowLeft size={18} /> 回大廳
      </Link>
      <span className="eyebrow">YOUR PRACTICE</span>
      <h1>每一局，都有紀錄</h1>
      <p className="lead">儲存在此瀏覽器的本地練習結果，只保留你的視角。清除網站資料會移除紀錄。</p>
      {isLoading ? (
        <p>正在讀取…</p>
      ) : error ? (
        <p role="alert">無法讀取：{error.message}</p>
      ) : data?.length ? (
        <div className="history-list">
          {data.map((entry) => {
            const r = entry.snapshot.public.result!;
            return (
              <article key={entry.gameId}>
                <div>
                  <strong>
                    {r.reason === 'win'
                      ? `第 ${r.winnerSeat! + 1} 席胡牌`
                      : r.reason === 'draw'
                        ? '流局'
                        : `第 ${r.penaltySeat! + 1} 席相公`}
                  </strong>
                  <p>
                    {new Date(entry.at).toLocaleString('zh-TW')}・
                    {entry.snapshot.public.rules.seatCount} 席・
                    {entry.snapshot.public.rules.presetId}
                  </p>
                </div>
                <div>
                  <strong>
                    {r.scores[0].delta > 0 ? '+' : ''}
                    {r.scores[0].delta} 分
                  </strong>
                  <p>
                    基礎 {r.baseHu} / 花 {r.flowerHu}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="note">
          <p>尚未完成任何牌局。</p>
          <Link to="/">開一桌練習</Link>
        </div>
      )}
    </main>
  );
}
