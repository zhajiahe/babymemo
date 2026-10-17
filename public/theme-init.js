/* Apply the saved appearance before Vite/React render, avoiding a light flash. */
(() => {
  const key = 'babymemo-theme';
  let choice = 'system';
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'light' || saved === 'dark') choice = saved;
  } catch { /* Private browsing may disable storage. */ }
  const dark = choice === 'dark' || (choice === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const effective = dark ? 'dark' : 'light';
  document.documentElement.dataset.theme = effective;
  document.documentElement.style.colorScheme = effective;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101820' : '#F8F8F6');
})();
