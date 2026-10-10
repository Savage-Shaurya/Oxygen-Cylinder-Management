import { useState } from 'react';
import { Truck } from '@phosphor-icons/react';
import { t } from '../../i18n';
import { Sheet } from '../components';

/** Asks for a truck number once; callers remember it on this phone. */
export default function VehicleSheet({
  initial = '',
  onSave,
  onClose,
}: {
  initial?: string;
  onSave: (vehicle: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Sheet title={t('vehicle.title')} onClose={onClose}>
      <form
        className="b-type-form"
        onSubmit={(event) => {
          event.preventDefault();
          const clean = value.replace(/\s+/g, ' ').trim().toUpperCase();
          if (clean) onSave(clean);
        }}
      >
        <label className="b-field b-plate">
          <span>
            <Truck size={22} weight="duotone" /> {t('vehicle.label')}
          </span>
          <input
            autoFocus
            value={value}
            maxLength={20}
            placeholder="DL 01 AB 1234"
            onChange={(event) => setValue(event.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button className="b-big solid tone-green" type="submit" disabled={!value.trim()}>
          {t('common.save')}
        </button>
      </form>
    </Sheet>
  );
}
