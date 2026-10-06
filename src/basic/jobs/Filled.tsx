import { Wrench } from '@phosphor-icons/react';
import { t } from '../../i18n';
import { EmptyState, Screen } from '../components';
import type { JobProps } from './shared';

// Placeholder: being built (see docs/simplification-plan.md).
export default function Filled({ home }: JobProps) {
  return (
    <Screen title={t('fill.title')} tone="green" say={t('fill.say')} onBack={home}>
      <EmptyState icon={<Wrench size={72} weight="duotone" />} text={t('fill.say')} />
    </Screen>
  );
}
