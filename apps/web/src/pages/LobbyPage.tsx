import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Cloud, Copy, Users } from 'lucide-react';
import type { SeatCount } from '@four-colors/game-core';
import { supabase } from '../lib/supabase.ts';
import { ensureGuest, roomCall } from '../lib/cloud.ts';
import type { CloudRoom } from '../lib/cloud.ts';
export function LobbyPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [userId, setUserId] = useState('');
  const [rooms, setRooms] = useState<CloudRoom[]>([]);
  const [room, setRoom] = useState<CloudRoom | null>(null);
  const [name, setName] = useState(() => localStorage.getItem('four-colors-name') ?? '玩家');
  const [seats, setSeats] = useState<SeatCount>(4);
  const [code, setCode] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    async function refresh() {
      try {
        const id = await ensureGuest();
        if (!alive) return;
        setUserId(id);
        if (roomId) {
          const next = await roomCall<CloudRoom>('get', { roomId });
          if (!alive) return;
          setRoom((current) =>
            current?.id === next.id && current.revision > next.revision ? current : next,
          );
          setInvite(localStorage.getItem(`four-colors-invite-${roomId}`) ?? '');
          if (next.status === 'playing' && next.gameId)
            navigate(`/game/${next.gameId}`, { state: { roomId } });
        } else {
          const next = await roomCall<CloudRoom[]>('list');
          if (alive) setRooms(next);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '連線失敗');
      }
    }
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 5000);
    const channel = roomId
      ? supabase
          .channel(`room:${roomId}`, { config: { private: true } })
          .on('broadcast', { event: 'changed' }, () => void refresh())
          .subscribe()
      : null;
    return () => {
      alive = false;
      clearInterval(timer);
      if (channel) void supabase!.removeChannel(channel);
    };
  }, [roomId, navigate]);
  async function action(operation: string, data: Record<string, unknown> = {}) {
    setBusy(true);
    setError('');
    setNotice('');
    localStorage.setItem('four-colors-name', name.trim());
    try {
      setUserId(await ensureGuest());
      if (operation === 'create' || operation === 'invite') {
        const result = await roomCall<{ room: CloudRoom; code: string }>(operation, data);
        localStorage.setItem(`four-colors-invite-${result.room.id}`, result.code);
        setInvite(result.code);
        setRoom(result.room);
        navigate(`/room/${result.room.id}`);
      } else if (operation === 'join') {
        const joined = await roomCall<CloudRoom>(operation, data);
        setRoom(joined);
        navigate(`/room/${joined.id}`);
      } else if (operation === 'start') {
        const result = await roomCall<{ gameId: string }>(operation, data);
        navigate(`/game/${result.gameId}`, { state: { roomId } });
      } else if (operation === 'leave') {
        await roomCall(operation, data);
        setRoom(null);
        navigate('/lobby');
      } else setRoom(await roomCall<CloudRoom>(operation, data));
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失敗');
      if (roomId) setRoom(await roomCall<CloudRoom>('get', { roomId }).catch(() => room));
    } finally {
      setBusy(false);
    }
  }
  const mine = room?.members.find((m) => m.userId === userId);
  const host = room?.hostUserId === userId;
  return (
    <main className="document-page lobby-page">
      <Link className="back-link" to="/">
        <ArrowLeft size={18} /> 回大廳
      </Link>
      <span className="eyebrow">PLAY TOGETHER</span>
      <h1>{roomId ? '朋友的牌桌' : '邀朋友，一起同桌'}</h1>
      <p className="lead">2–6 席真人與 AI 混合對戰，也可一人開房與電腦練習。</p>
      {!supabase ? (
        <section className="note">
          <Cloud />
          <h2>尚未設定雲端連線</h2>
          <p>本地練習仍可使用。</p>
        </section>
      ) : roomId ? (
        room ? (
          <section className="room-panel">
            <div className="room-title">
              <h2>
                {room.seatCount} 席・{room.status === 'playing' ? '進行中' : '等待準備'}
              </h2>
              <span>{host ? '你是房主' : '已加入房間'}</span>
            </div>
            <p>
              {room.seatCount > 4
                ? '擴充房規：5 席每人 16 張、6 席每人 14 張，莊家多 1 張。'
                : '標準產品房規：每人 20 張，莊家 21 張。'}
            </p>
            {invite && host && (
              <div className="invite-box">
                <span>邀請碼（24 小時有效）</span>
                <strong>{invite}</strong>
                <button
                  className="quiet"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(invite);
                      setNotice('邀請碼已複製');
                    } catch {
                      setNotice('請選取並複製上方邀請碼');
                    }
                  }}
                >
                  <Copy size={16} /> 複製
                </button>
              </div>
            )}
            {host && (
              <button
                className="quiet"
                disabled={busy}
                onClick={() => void action('invite', { roomId })}
              >
                {invite ? '更新邀請碼' : '取得邀請碼'}
              </button>
            )}
            <div className="room-seats">
              {Array.from({ length: room.seatCount }, (_, seat) => {
                const member = room.members.find((m) => m.seat === seat),
                  ai = room.aiSeats.find((a) => a.seat === seat);
                return (
                  <div className="room-seat" key={seat}>
                    <span className="seat-avatar">{seat + 1}</span>
                    <div>
                      <strong>
                        {member
                          ? `${member.name}${member.userId === userId ? '（你）' : ''}`
                          : ai
                            ? '電腦'
                            : '空位'}
                      </strong>
                      <p>
                        {member
                          ? member.ready
                            ? '已準備'
                            : '尚未準備'
                          : ai
                            ? ai.difficulty === 'normal'
                              ? '一般難度'
                              : '輕鬆難度'
                            : '朋友可用邀請碼加入'}
                      </p>
                    </div>
                    {!member && host && room.status === 'waiting' && (
                      <select
                        aria-label={`第 ${seat + 1} 席`}
                        disabled={busy}
                        value={ai?.difficulty ?? ''}
                        onChange={(e) =>
                          void action('ai', {
                            roomId,
                            revision: room.revision,
                            seat,
                            difficulty: e.target.value || null,
                          })
                        }
                      >
                        <option value="">留給朋友</option>
                        <option value="easy">輕鬆 AI</option>
                        <option value="normal">一般 AI</option>
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="actions">
              {room.status === 'waiting' && (
                <>
                  <button
                    className="primary"
                    disabled={busy || !mine}
                    onClick={() =>
                      void action('ready', { roomId, revision: room.revision, ready: !mine?.ready })
                    }
                  >
                    {mine?.ready ? '取消準備' : '我準備好了'}
                  </button>
                  {host && (
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        room.members.some((m) => !m.ready) ||
                        room.members.length + room.aiSeats.length !== room.seatCount
                      }
                      onClick={() => void action('start', { roomId, revision: room.revision })}
                    >
                      開始對戰
                    </button>
                  )}
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() => void action('leave', { roomId, revision: room.revision })}
                  >
                    離開房間
                  </button>
                </>
              )}
              {room.gameId && (
                <Link className="quiet" to={`/game/${room.gameId}`} state={{ roomId }}>
                  返回最近牌局
                </Link>
              )}
            </div>
          </section>
        ) : (
          <p>正在連線到房間…</p>
        )
      ) : (
        <>
          <label className="lobby-name">
            你的暱稱
            <input maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="lobby-forms">
            <section className="room-panel">
              <Users />
              <h2>開一桌</h2>
              <label>
                總座位數
                <select
                  value={seats}
                  onChange={(e) => setSeats(Number(e.target.value) as SeatCount)}
                >
                  {[2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} 席
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary"
                disabled={busy || !name.trim()}
                onClick={() => void action('create', { name, seatCount: seats })}
              >
                建立房間
              </button>
            </section>
            <section className="room-panel">
              <Cloud />
              <h2>加入朋友</h2>
              <label>
                邀請碼
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="輸入 12 碼邀請碼"
                  autoCapitalize="characters"
                />
              </label>
              <button
                className="primary"
                disabled={busy || !name.trim() || code.replace(/[\s-]/g, '').length !== 12}
                onClick={() => void action('join', { name, code })}
              >
                加入房間
              </button>
            </section>
          </div>
          {rooms.length > 0 && (
            <section>
              <h2>你的房間</h2>
              <div className="room-list">
                {rooms.map((r) => (
                  <Link className="room-panel" key={r.id} to={`/room/${r.id}`}>
                    <strong>{r.seatCount} 席牌桌</strong>
                    <span>
                      {r.status === 'playing' ? '正在對戰' : '等待準備'}・{r.members.length} 位真人
                      / {r.aiSeats.length} 位 AI
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          <p className="muted">
            訪客身分保存在這個瀏覽器。清除網站資料後會建立新身分；跨裝置請各自使用邀請碼加入。對局離線超過
            90 秒會由 AI 代打至本局結束。
          </p>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </main>
  );
}
