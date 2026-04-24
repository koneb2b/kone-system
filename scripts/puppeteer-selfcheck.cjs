const puppeteer = require('puppeteer');

const BASE_URL = 'http://127.0.0.1:5173';
const MAX_RETRIES = 2;
const MODULE_COUNT = 4;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForServer = async (page) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 15000 });
      return true;
    } catch {
      await sleep(1000);
    }
  }
  return false;
};

const openSettings = async (page) => {
  await page.waitForSelector('button[data-nav-id="settings"]', { timeout: 15000 });
  await page.click('button[data-nav-id="settings"]');
  await page.waitForSelector('[data-testid="api-card-llm"]', { timeout: 15000 });
};

const fillApiKeys = async (page) => {
  const providers = ['llm', 'google-leads', 'google-maps', 'decision-maker'];
  for (const provider of providers) {
    const selector = `[data-testid="api-key-${provider}"]`;
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.click(selector, { clickCount: 3 });
    await page.type(selector, `test-key-${provider}`);
  }
};

const clickApiTestButtons = async (page) => {
  const providers = ['llm', 'google-leads', 'google-maps', 'decision-maker'];
  for (const provider of providers) {
    const selector = `[data-testid="api-test-${provider}"]`;
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.click(selector);
  }
};

const waitForModulesGreen = async (page) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const connectedCount = await page.evaluate(() => {
      const badges = Array.from(document.querySelectorAll('[data-testid^="api-status-"]'));
      return badges.filter((badge) => badge.getAttribute('data-status') === 'connected').length;
    });
    if (connectedCount >= MODULE_COUNT) return true;
    await sleep(500);
  }
  return false;
};

const waitForConnectionSuccess = async (page) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const found = await page.evaluate(() => {
      return !!document.querySelector('[data-testid="connection-success"]');
    });
    if (found) return true;
    await sleep(500);
  }
  return false;
};

const run = async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  const consoleErrors = [];

  page.on('console', (msg) => {
    const text = msg.text();
    if (/404|ERR_SSL/i.test(text)) consoleErrors.push(text);
  });

  const serverReady = await waitForServer(page);
  if (!serverReady) {
    await browser.close();
    throw new Error('dev server not reachable');
  }

  const hasElectronApi = await page.evaluate(() => !!window.electronAPI);
  if (!hasElectronApi) {
    await browser.close();
    throw new Error('window.electronAPI missing');
  }

  await openSettings(page);

  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    await fillApiKeys(page);
    await clickApiTestButtons(page);

    const success = await waitForConnectionSuccess(page);
    const modulesGreen = await waitForModulesGreen(page);
    if (success && modulesGreen) {
      const shotPath = `selfcheck-connection-success-${Date.now()}.png`;
      await page.screenshot({ path: shotPath, fullPage: true });
      await browser.close();
      return { success: true, screenshot: shotPath, consoleErrors };
    }

    attempt += 1;
  }

  const shotPath = `selfcheck-connection-failed-${Date.now()}.png`;
  await page.screenshot({ path: shotPath, fullPage: true });
  await browser.close();
  return { success: false, screenshot: shotPath, consoleErrors };
};

run()
  .then((result) => {
    if (!result.success) {
      console.error('Selfcheck failed', result);
      process.exit(1);
    }
    console.log('Selfcheck passed', result);
  })
  .catch((error) => {
    console.error('Selfcheck error', error?.message || error);
    process.exit(1);
  });
