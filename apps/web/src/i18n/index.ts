/**
 * Typed message catalog (SPEC §7.5). Every user-visible string goes through `m`.
 * Other locales implement `Messages` (the structural type of `en`) and are swapped in
 * with `setLocaleMessages`; formatting uses Intl with the member's locale.
 */
import { en } from './en';

type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => string
    ? (...args: A) => string
    : { [K in keyof T]: Widen<T[K]> };

export type Messages = Widen<typeof en>;

export let m: Messages = en;
let currentLocale = 'en';

export function setLocaleMessages(locale: string, messages: Messages): void {
  currentLocale = locale;
  m = messages;
}

export function locale(): string {
  return currentLocale;
}

export { en };
