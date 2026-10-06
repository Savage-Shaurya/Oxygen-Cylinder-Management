import { Buildings, Factory, House, Hospital, Truck, Warehouse } from '@phosphor-icons/react';
import type { Party } from '../../shared/types';
import type { BasicStatus } from './model';

export type CylinderLook = 'full' | 'empty' | 'hold' | 'unknown' | 'wait';

export const lookFor: Record<BasicStatus, CylinderLook> = {
  ready: 'full',
  wait: 'wait',
  empty: 'empty',
  hold: 'hold',
  unsure: 'unknown',
};

/** A gas cylinder drawn so full, empty, on-hold and unknown look different without words. */
export function CylinderPic({ look = 'full', size = 56 }: { look?: CylinderLook; size?: number }) {
  const body =
    look === 'full' || look === 'wait'
      ? 'var(--b-blue)'
      : look === 'hold'
        ? 'var(--b-red)'
        : look === 'unknown'
          ? '#8a8f98'
          : '#ffffff';
  const stroke = look === 'empty' ? '#3a4150' : 'rgba(0,0,0,.18)';
  return (
    <svg
      width={size * 0.62}
      height={size}
      viewBox="0 0 40 64"
      aria-hidden="true"
      className={`cyl-pic cyl-${look}`}
    >
      <rect x="15" y="1.5" width="10" height="6" rx="2" fill="#3a4150" />
      <rect x="12" y="6.5" width="16" height="5" rx="2.5" fill="#596173" />
      <path
        d="M8 20c0-6 5-9 12-9s12 3 12 9v36a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6z"
        fill={body}
        stroke={stroke}
        strokeWidth="2.5"
      />
      {look === 'empty' && (
        <path d="M14 52h12" stroke="#c4cad4" strokeWidth="3" strokeLinecap="round" />
      )}
      {(look === 'full' || look === 'wait') && (
        <path
          d="M13 22c2-3 5-4 7-4"
          stroke="rgba(255,255,255,.55)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      )}
      {look === 'hold' && (
        <path d="M14 30l12 12M26 30L14 42" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
      )}
      {look === 'unknown' && (
        <text x="20" y="45" textAnchor="middle" fontSize="20" fontWeight="800" fill="#fff">
          ?
        </text>
      )}
      {look === 'wait' && (
        <circle cx="20" cy="38" r="6" fill="var(--b-amber)" stroke="#fff" strokeWidth="2" />
      )}
    </svg>
  );
}

export function PartyIcon({ type, size = 30 }: { type?: Party['type']; size?: number }) {
  if (type === 'hospital') return <Hospital size={size} weight="duotone" />;
  if (type === 'homecare') return <House size={size} weight="duotone" />;
  if (type === 'industrial') return <Factory size={size} weight="duotone" />;
  return <Buildings size={size} weight="duotone" />;
}

export function PlaceIcon({ custody, size = 30 }: { custody: string; size?: number }) {
  if (custody === 'plant') return <Warehouse size={size} weight="duotone" />;
  if (custody === 'vehicle') return <Truck size={size} weight="duotone" />;
  if (custody === 'supplier') return <Buildings size={size} weight="duotone" />;
  return <Hospital size={size} weight="duotone" />;
}
