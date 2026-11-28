import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { miniRoot, miniRequire, capturePage } from './fixtures/nativeClient';
const { initializeAppearance, appearanceData, storageKey } = miniRequire('./miniprogram/utils/appearance');
const { keyboardLayout } = miniRequire('./miniprogram/utils/keyboard-layout');

function fixture(stored?: unknown) {
  const storage = new Map([[storageKey, stored]]), chrome: any[] = [], pages: any[] = [];
  const platform: any = { getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    setTabBarStyle: (value: any) => chrome.push(['style', value]), setTabBarItem: (value: any) => chrome.push(['item', value]), setNavigationBarColor() {}, setNavigationBarTitle() {}, setBackgroundColor() {}, showToast() {},
    request: assert.fail, login: assert.fail, authorize: assert.fail };
  const app: any = { client: { hasSession: () => false }, subscribe: () => () => {} };
  initializeAppearance(app, platform, () => pages);
  return { app, platform, pages, storage, chrome };
}

test('first launch and invalid stored themes use enamel; explicit choice persists and updates cached pages without login', () => {
  for (const value of [undefined, '', '__proto__', {}, 'unknown']) assert.equal(fixture(value).app.appearance, 'fresh');
  const f = fixture();
  const a: any = { setData(patch: any) { this.data = patch; } }, b: any = { setData(patch: any) { this.data = patch; } };
  f.pages.push(a, b);
  assert.equal(f.app.setAppearance('rich'), true);
  assert.equal(a.data.theme, 'rich'); assert.equal(b.data.theme, 'rich'); assert.equal(f.storage.get(storageKey), 'rich');
  assert.equal(fixture(f.storage.get(storageKey)).app.appearance, 'rich');
  assert.equal(f.app.setAppearance('invalid'), false); assert.equal(f.storage.get(storageKey), 'rich');
  const active = f.chrome.filter(row => row[0] === 'item');
  assert.deepEqual(active.map(([, item]) => [item.index, path.basename(item.iconPath)]), [[0, 'idea.png'], [1, 'create.png'], [2, 'library.png']]);
  assert.ok(active.every(row => row[1].iconPath.includes('/rich/idle/') && row[1].selectedIconPath.includes('/rich/active/')));
  f.platform.setStorageSync = () => { throw new Error('storage full'); };
  assert.equal(f.app.setAppearance('fresh'), false); assert.equal(f.app.appearance, 'rich');
});

test('login, legal, feedback, about and every main tab inherit the chosen theme without authenticating', async () => {
  const f = fixture('rich');
  const config = JSON.parse(await readFile(path.join(miniRoot, 'app.json'), 'utf8'));
  for (const route of config.pages) {
    const name = route.split('/')[1], page = await capturePage(name, f.app, f.platform);
    f.app.applyAppearance(page);
    assert.equal(page.data.theme, 'rich', name);
    assert.match(page.data.icons.create, /rich\/active\/create\.png$/);
    const wxml = await readFile(path.join(miniRoot, route + '.wxml'), 'utf8');
    assert.ok(wxml.includes('theme-{{theme}}'), name + ' has a themed root including overlays');
  }
  const auth = await capturePage('auth', f.app, f.platform); await auth.onShow(); assert.equal(auth.data.theme, 'rich');
  for (const palette of ['fresh', 'rich']) {
    for (const icon of Object.values(appearanceData(palette).icons)) await readFile(path.join(miniRoot, String(icon).slice(1)));
  }
});

test('keyboard overlays and resized webviews lift the whole toolbar once and reset on keyboard close', () => {
  const base = { screenHeight: 844, statusBarHeight: 44, windowHeight: 673 };
  const ios = keyboardLayout(base, base, 346);
  assert.equal(ios.keyboardOffset, 263); assert.equal(ios.viewportHeight, 410);
  // Native tab/safe-area 83px + composer offset 263px equals keyboard height.
  assert.equal(ios.keyboardOffset + 83, ios.keyboardHeight);
  const android = keyboardLayout(base, { ...base, windowHeight: 410 }, 346);
  assert.equal(android.keyboardOffset, 0); assert.equal(android.viewportHeight, 410);
  assert.equal(keyboardLayout(base, base, 0).viewportHeight, 673);
  assert.equal(keyboardLayout(base, base, 0).keyboardOffset, 0);
});

test('settings exposes feedback and version history, and permanent legal links are centralized there', async () => {
  const f = fixture(), navigation: string[] = []; f.platform.navigateTo = (options: any) => navigation.push(options.url);
  const settings = await capturePage('settings', f.app, f.platform);
  settings.feedback(); settings.about();
  assert.deepEqual(navigation, ['/pages/feedback/index', '/pages/about/index']);
  const feedback = await capturePage('feedback', f.app, f.platform);
  assert.equal(feedback.data.contacts.length, 2, 'feedback uses the two owner-provided public channels');
  let copied = ''; f.platform.setClipboardData = (options: any) => { copied = options.data; };
  feedback.copyContact({ currentTarget: { dataset: { id: 'unknown' } } }); assert.equal(copied, '');
  feedback.copyContact({ currentTarget: { dataset: { id: 'qq-group' } } }); assert.equal(copied, '1040198206');
  feedback.copyContact({ currentTarget: { dataset: { id: 'wechat-official' } } }); assert.equal(copied, '逍逍子');
  const version = miniRequire('./miniprogram/utils/version'), releases = miniRequire('./miniprogram/utils/releases');
  const pkg = JSON.parse(await readFile('apps/miniprogram/package.json', 'utf8'));
  assert.equal(settings.data.version, pkg.version); assert.equal(version, pkg.version); assert.equal(releases[0].version, pkg.version);
  assert.ok(releases.some((release: any) => release.features.some((value: string) => value.includes('意见反馈'))), 'feedback remains documented in its original release');
  const about = await capturePage('about', f.app, f.platform); about.onLoad({ version }); assert.equal(about.data.selected.version, version);
  about.onLoad({ version: '<untrusted>' }); assert.equal(about.data.selected, null);
  const wxml = await readFile(path.join(miniRoot, 'pages/settings/index.wxml'), 'utf8');
  for (const type of ['privacy', 'voice', 'terms']) assert.ok(wxml.includes('data-type="' + type + '"'));
});

test('the resources wallet displays current points and opens the appropriate entry for guests and members', async () => {
  const f = fixture(), routes: string[] = [];
  f.platform.navigateTo = (options: any) => routes.push(options.url);
  const page = await capturePage('library', f.app, f.platform);
  page.onShow();
  assert.equal(page.data.guest, true);
  page.credits();
  assert.deepEqual(routes, ['/pages/auth/index']);
  f.app.client.hasSession = () => true;
  page.render({ credits: { balance: 991935.2, dailyGrant: 500, canCheckIn: true }, media: [], artifacts: [], jobs: [] });
  assert.equal(page.data.balance, '991,935.20');
  assert.equal(page.data.dailyReward, '500');
  assert.equal(page.data.canCheckIn, true);
  page.credits();
  assert.deepEqual(routes, ['/pages/auth/index', '/pages/credits/index']);
  const wxml = await readFile(path.join(miniRoot, 'pages/library/index.wxml'), 'utf8');
  assert.match(wxml, /class="wallet-card" bindtap="credits"/);
  assert.match(wxml, /我的创作积分/);
  assert.doesNotMatch(wxml, /bindtap="(?:legal|logout|editAvatar|editName)"/);
});

test('settings logout submits once and does not clear a newer account', async () => {
  const f = fixture();
  let loggedIn = false, requests = 0, expired = 0;
  let finish!: () => void;
  f.app._generation = 1;
  f.app.client.hasSession = () => loggedIn;
  f.app.client.request = (route: string) => {
    assert.equal(route, '/api/auth/logout');
    requests++;
    return new Promise<void>(resolve => { finish = resolve; });
  };
  f.app.expired = () => { expired++; };
  const settings = await capturePage('settings', f.app, f.platform);
  settings._visible = true;
  await settings.logout();
  assert.equal(requests, 0);
  loggedIn = true;
  const pending = settings.logout();
  assert.equal(settings.data.loggingOut, true);
  await settings.logout();
  assert.equal(requests, 1);
  f.app._generation++;
  finish();
  await pending;
  assert.equal(expired, 0);
  assert.equal(settings.data.loggingOut, false);
  const current = settings.logout();
  finish();
  await current;
  assert.equal(expired, 1);
});
