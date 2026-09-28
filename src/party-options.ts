import type { Party } from '../shared/types';

export function allowedPartyTypes(mode: 'customer' | 'supplier' | 'edit'): Party['type'][] {
  if (mode === 'supplier') return ['supplier'];
  if (mode === 'customer') return ['hospital', 'homecare', 'industrial'];
  return ['hospital', 'homecare', 'industrial', 'supplier'];
}
