// Bootstrap briefly has no navigation. Wait for the app shell before deciding
// whether the mobile sidebar needs opening.
export async function openNotebookTab(page, name) {
  const toggle = page.locator('button[aria-label="Toggle navigation"]');
  await toggle.waitFor({ state: 'attached' });
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') !== 'true')
    await toggle.click();
  await page.getByRole('button', { name, exact: true }).click();
}
