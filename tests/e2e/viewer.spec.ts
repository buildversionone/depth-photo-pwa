import { expect, test, type Page } from '@playwright/test';

interface DebugState {
  offset: { x: number; y: number };
  scene: { width: number; height: number; maxOffset: number };
  renderer: string;
}

const state = (page: Page) =>
  page.evaluate(() => (window as unknown as { __depthPhoto: DebugState }).__depthPhoto && {
    offset: (window as unknown as { __depthPhoto: DebugState }).__depthPhoto.offset,
    scene: (window as unknown as { __depthPhoto: DebugState }).__depthPhoto.scene,
    renderer: (window as unknown as { __depthPhoto: DebugState }).__depthPhoto.renderer,
  });

/** Dispatch synthetic devicemotion events as if the phone were tilted by `rollDeg`. */
async function tilt(page: Page, rollDeg: number, frames = 90) {
  await page.evaluate(
    async ({ rollDeg, frames }) => {
      const g = 9.81;
      const r = (rollDeg * Math.PI) / 180;
      for (let i = 0; i < frames; i++) {
        const e = new Event('devicemotion') as Event & { accelerationIncludingGravity: unknown };
        Object.defineProperty(e, 'accelerationIncludingGravity', {
          value: { x: g * Math.sin(r), y: g * Math.cos(r) * 0.8, z: g * Math.cos(r) * 0.6 },
        });
        window.dispatchEvent(e);
        await new Promise((res) => requestAnimationFrame(res));
      }
    },
    { rollDeg, frames },
  );
}

test.beforeEach(async ({ page, context }) => {
  // Recent Chrome gates motion events behind DeviceOrientationEvent.requestPermission().
  await context.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer']).catch(() => {});
  await page.goto('/');
  await expect(page.locator('#view')).toBeVisible();
  await page.waitForFunction(() => 'renderer' in ((window as unknown as { __depthPhoto?: object }).__depthPhoto ?? {}));
  const enable = page.getByRole('button', { name: 'Enable motion' });
  if (await enable.isVisible()) await enable.click();
});

test('renders the sample scene with WebGL2 and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.reload();
  await page.waitForTimeout(500);
  const s = await state(page);
  expect(s.renderer).toBe('webgl2');
  expect(errors).toEqual([]);
  // The canvas is not blank: sample pixels from the rendered frame.
  const shot = await page.locator('#view').screenshot();
  expect(shot.byteLength).toBeGreaterThan(10_000);
});

test('tilt moves the background, bounded by the max offset', async ({ page }) => {
  await tilt(page, 0, 10); // neutral pose
  await tilt(page, 40, 120); // extreme tilt
  const s = await state(page);
  const limit = s.scene.maxOffset * Math.min(s.scene.width, s.scene.height);
  expect(Math.abs(s.offset.x)).toBeGreaterThan(limit * 0.5);
  expect(Math.abs(s.offset.x)).toBeLessThanOrEqual(limit + 1e-6);
  expect(Math.abs(s.offset.y)).toBeLessThanOrEqual(limit + 1e-6);
});

test('the foreground stays fixed while the background moves', async ({ page }) => {
  // Pixels on the hiker's torso must be identical before and after a tilt.
  const box = (await page.locator('#view').boundingBox())!;
  const { scene } = await state(page);
  const m = scene.maxOffset * Math.min(scene.width, scene.height);
  const cropW = scene.width - 2 * m;
  const cropH = scene.height - 2 * m;
  const k = Math.min(box.width / cropW, box.height / cropH);
  // Torso centre in image pixels (see src/scene/sample.ts).
  const imgX = scene.width * 0.36 - 3 * scene.height * 0.0027;
  const imgY = scene.height * 0.797 - 90 * scene.height * 0.0027;
  const x = box.x + (box.width - cropW * k) / 2 + (imgX - m) * k;
  const y = box.y + (box.height - cropH * k) / 2 + (imgY - m) * k;
  const probe = async () => (await page.screenshot({ clip: { x: x - 3, y: y - 3, width: 6, height: 6 } })).toString('base64');
  // Control: a background point well away from the subject must change.
  const bgProbe = async () =>
    (await page.screenshot({ clip: { x: box.x + box.width * 0.8, y: box.y + box.height * 0.45, width: 6, height: 6 } })).toString('base64');
  await tilt(page, 0, 10);
  const before = await probe();
  const bgBefore = await bgProbe();
  await tilt(page, 30, 120);
  expect(await probe()).toBe(before);
  expect(await bgProbe()).not.toBe(bgBefore);
});

test('drag moves the view when there are no sensors', async ({ page }) => {
  const box = (await page.locator('#view').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 3, { steps: 8 });
  await page.waitForTimeout(600);
  const s = await state(page);
  expect(s.offset.x).toBeGreaterThan(1);
  await page.mouse.up();
});

test('reset view returns the background to centre', async ({ page }) => {
  const box = (await page.locator('#view').boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 160, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Reset view' }).click();
  // Software rendering on CI can be slow; the spring caps each step, so poll.
  await expect
    .poll(async () => {
      const s = await state(page);
      return Math.max(Math.abs(s.offset.x), Math.abs(s.offset.y));
    }, { timeout: 10_000 })
    .toBeLessThan(0.5);
});

test('reduced motion starts with motion off', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Motion off' })).toBeVisible();
  await expect(page.locator('#status')).toContainText('reduced motion');
  await ctx.close();
});

test('works offline after the first visit', async ({ browser }) => {
  test.setTimeout(90_000);
  // Own context, so the service worker installs from scratch. SwiftShader makes first load slow.
  const context = await browser.newContext({ baseURL: 'http://localhost:4173' });
  const page = await context.newPage();
  await page.goto('/');
  // Wait until the service worker has finished precaching the app shell.
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg?.active?.state !== 'activated') return false;
    for (const key of await caches.keys()) {
      const reqs = await (await caches.open(key)).keys();
      if (reqs.some((r) => r.url.includes('index.html'))) return true;
    }
    return false;
  }, null, { timeout: 45_000 });
  await page.waitForTimeout(3000);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#view')).toBeVisible();
  await page.waitForFunction(() => (window as unknown as { __depthPhoto?: { renderer: string } }).__depthPhoto?.renderer === 'webgl2');
  await context.close();
});
