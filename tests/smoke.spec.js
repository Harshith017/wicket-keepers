// @ts-check
const { test, expect } = require('@playwright/test');

test('home page loads with the app title', async ({ page }) => {
  const errors = [];
  let firebaseCdnBlocked = false;
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('requestfailed', (req) => {
    if (req.url().includes('gstatic.com/firebasejs')) firebaseCdnBlocked = true;
  });

  await page.goto('/');
  await expect(page).toHaveTitle(/Wicket Keepers/);
  await expect(page.locator('body')).toBeVisible();

  // On a network that blocks the Firebase CDN, `firebase is not defined` is expected;
  // any other uncaught error still fails the test.
  const unexpected = firebaseCdnBlocked
    ? errors.filter((m) => !/firebase/i.test(m))
    : errors;
  if (firebaseCdnBlocked) {
    test.info().annotations.push({ type: 'warning', description: 'Firebase CDN unreachable; Firebase errors ignored.' });
  }
  expect(unexpected, 'uncaught page errors').toEqual([]);
});
