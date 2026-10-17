import {useSyncExternalStore} from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'babymemo-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const subscribers = new Set<() => void>();

function readPreference(): ThemePreference {
 try {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
 } catch {
  return 'system';
 }
}

let preference: ThemePreference = readPreference();

function applyTheme() {
 const effective = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
 document.documentElement.dataset.theme = effective;
 document.documentElement.style.colorScheme = effective;
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content', effective === 'dark' ? '#101820' : '#F8F8F6');
 subscribers.forEach(listener => listener());
}

function subscribe(listener: () => void) {
 subscribers.add(listener);
 return () => { subscribers.delete(listener); };
}

export function useThemePreference(): ThemePreference {
 return useSyncExternalStore(subscribe, () => preference, () => 'system');
}

export function setThemePreference(next: ThemePreference) {
 if (next !== 'system' && next !== 'light' && next !== 'dark') return;
 preference = next;
 try {
  if (next === 'system') localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, next);
 } catch { /* Continue applying the choice for this session. */ }
 applyTheme();
}

// Sync across tabs and the same-origin mobile Demo iframe.
window.addEventListener('storage', event => {
 if (event.key === STORAGE_KEY || event.key === null) {
  preference = readPreference();
  applyTheme();
 }
});
// Returning from the browser back/forward cache must refresh device settings.
window.addEventListener('pageshow', event => {
 if (event.persisted) {
  preference = readPreference();
  applyTheme();
 }
});
if (typeof media.addEventListener === 'function') {
 media.addEventListener('change', () => { if (preference === 'system') applyTheme(); });
} else {
 media.addListener(() => { if (preference === 'system') applyTheme(); });
}
applyTheme();
