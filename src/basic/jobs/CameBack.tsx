import { Wrench } from '@phosphor-icons/react';
import { t } from '../../i18n';
import { EmptyState, Screen } from '../components';
import type { JobProps } from './shared';

// Placeholder: being built (see docs/simplification-plan.md).
export default function CameBack({ home }: JobProps) {
  return (
    <Screen title={t('back.title')} tone="blue" say={t('back.say')} onBack={home}>
      <EmptyState icon={<Wrench size={72} weight="duotone" />} text={t('back.say')} />
    </Screen>
  );
}
