import { COLOR_NAMES, decodeTile, ROLE_NAMES, tileLabel } from '@four-colors/game-core';
import styles from './Tile.module.css';
export function Tile({
  id,
  selected = false,
  onClick,
  disabled = false,
  mini = false,
}: {
  id: number;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  mini?: boolean;
}) {
  const tile = decodeTile(id);
  const className = `tile ${styles.tile} ${tile.color} ${styles[tile.color]} ${selected ? `selected ${styles.selected}` : ''} ${mini ? `mini ${styles.mini}` : ''}`;
  const content = (
    <>
      <span className={`tile-color ${styles['tile-color']}`}>{COLOR_NAMES[tile.color]}</span>
      <span className={`tile-character ${styles['tile-character']}`}>{ROLE_NAMES[tile.role]}</span>
      <span className={`tile-copies ${styles['tile-copies']}`} aria-hidden="true">
        {'·'.repeat((id % 4) + 1)}
      </span>
    </>
  );
  return onClick ? (
    <button
      type="button"
      className={className}
      aria-label={`${tileLabel(id)}${selected ? '，已選取' : ''}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <span role="img" aria-label={tileLabel(id)} className={className}>
      {content}
    </span>
  );
}
