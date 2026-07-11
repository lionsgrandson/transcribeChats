import { useAppStore } from '../state/AppStore';
import { translate, type TranslationKey } from './translations';

export function useTranslation() {
  const { settings } = useAppStore();
  return {
    locale: settings.locale,
    dir: settings.locale === 'he' ? 'rtl' as const : 'ltr' as const,
    t: (key: TranslationKey) => translate(settings.locale, key)
  };
}
