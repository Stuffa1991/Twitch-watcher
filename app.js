require('dotenv').config();
const puppeteer = require('puppeteer-core');
const dayjs = require('dayjs');
const cheerio = require('cheerio');
const fs = require('fs');
const inquirer = require('./input');
const treekill = require('tree-kill');

var run = true;
var firstRun = true;
var cookie = null;
// ========================================== CONFIG SECTION =================================================================
const configPath = './config.json'
const baseUrl = 'https://www.twitch.tv/';
const userAgent = (process.env.userAgent || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36');
const watch = 'myth';

const showBrowser = false; // false state equ headless mode;
const proxy = (process.env.proxy || ""); // "ip:port" By https://github.com/Jan710
const proxyAuth = (process.env.proxyAuth || "");

const browserClean = 1;
const browserCleanUnit = 'hour';

var browserConfig = {
  headless: !showBrowser,
  args: [
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox'
  ]
}; //https://github.com/D3vl0per/Valorant-watcher/issues/24

const cookiePolicyQuery = 'button[data-a-target="consent-banner-accept"]';
const matureContentQuery = 'button[data-a-target="player-overlay-mature-accept"]';
const hindsight2020Query = 'div.mega-commerce-callout__dismiss>button'
const sidebarQuery = '*[data-test-selector="user-menu__toggle"]';
const userStatusQuery = 'span[data-a-target="presence-text"]';
const streamPauseQuery = 'button[data-a-target="player-play-pause-button"]';
const streamSettingsQuery = '[data-a-target="player-settings-button"]';
const streamQualitySettingQuery = '[data-a-target="player-settings-menu-item-quality"]';
const streamQualityQuery = 'input[data-a-target="tw-radio"]';
// ========================================== CONFIG SECTION =================================================================



async function viewStreamer(browser, page) {
  var browser_last_refresh = dayjs().add(browserClean, browserCleanUnit);
  while (run) {
    try {
      if (dayjs(browser_last_refresh).isBefore(dayjs())) {
        var newSpawn = await cleanup(browser, page);
        browser = newSpawn.browser;
        page = newSpawn.page;
        firstRun = true;
        browser_last_refresh = dayjs().add(browserClean, browserCleanUnit);
      }

      console.log('\n🔗 Now watching streamer: ', baseUrl + watch);

      await page.goto(baseUrl + watch, {
        "waitUntil": "networkidle0"
      }); //https://github.com/puppeteer/puppeteer/blob/master/docs/api.md#pagegobackoptions

      await clickWhenExist(page, cookiePolicyQuery);
      await clickWhenExist(page, matureContentQuery); //Click on accept button

      if (firstRun) {
        console.log('🔧 Setting lowest possible resolution..');
        await clickWhenExist(page, hindsight2020Query); // Twitch has some 2020 hindsight popup atm.
        await clickWhenExist(page, streamPauseQuery);

        await clickWhenExist(page, streamSettingsQuery);
        await page.waitFor(streamQualitySettingQuery);

        await clickWhenExist(page, streamQualitySettingQuery);
        await page.waitFor(streamQualityQuery);

        var resolution = await queryOnWebsite(page, streamQualityQuery);
        resolution = resolution[resolution.length - 1].attribs.id;
        await page.evaluate((resolution) => {
          document.getElementById(resolution).click();
        }, resolution);

        await clickWhenExist(page, streamPauseQuery);

        firstRun = false;
      }

      await clickWhenExist(page, sidebarQuery); //Open sidebar
      await page.waitFor(userStatusQuery); //Waiting for sidebar
      let status = await queryOnWebsite(page, userStatusQuery); //status jQuery
      await clickWhenExist(page, sidebarQuery); //Close sidebar
      const sleep = 60 * 60000; // Sleeping minutes

      console.log('💡 Account status:', status[0] ? status[0].children[0].data : "Unknown");
      console.log('🕒 Time: ' + dayjs().format('HH:mm:ss'));
      console.log('💤 Watching stream for ' + sleep / 60000 + ' minutes\n');

      await page.waitFor(sleep);
    } catch (e) {
      console.log('🤬 Error: ', e);
      console.log('Please visit the discord channel to receive help: https://discord.gg/s8AH4aZ');
    }
  }
}



async function readLoginData() {
  const cookie = [{
    "domain": ".twitch.tv",
    "hostOnly": false,
    "httpOnly": false,
    "name": "auth-token",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": "0",
    "id": 1
  }];
  try {
    console.log('🔎 Checking config file...');

    if (fs.existsSync(configPath)) {
      console.log('✅ Json config found!');

      let configFile = JSON.parse(fs.readFileSync(configPath, 'utf8'))

      if (proxy) browserConfig.args.push('--proxy-server=' + proxy);
      browserConfig.executablePath = configFile.exec;
      cookie[0].value = configFile.token;

      return cookie;
    } else if (process.env.token) {
      console.log('✅ Env config found');

      if (proxy) browserConfig.args.push('--proxy-server=' + proxy);
      cookie[0].value = process.env.token; //Set cookie from env
      browserConfig.executablePath = '/usr/bin/chromium-browser'; //For docker container

      return cookie;
    } else {
      console.log('❌ No config file found!');

      let input = await inquirer.askLogin();

      fs.writeFile(configPath, JSON.stringify(input), function(err) {
        if (err) {
          console.log(err);
        }
      });

      if (proxy) browserConfig.args[6] = '--proxy-server=' + proxy;
      browserConfig.executablePath = input.exec;
      cookie[0].value = input.token;

      return cookie;
    }
  } catch (err) {
    console.log('🤬 Error: ', e);
    console.log('Please visit my discord channel to solve this problem: https://discord.gg/s8AH4aZ');
  }
}



async function spawnBrowser() {
  console.log("=========================");
  console.log('📱 Launching browser...');
  var browser = await puppeteer.launch(browserConfig);
  var page = await browser.newPage();

  console.log('🔧 Setting User-Agent...');
  await page.setUserAgent(userAgent); //Set userAgent

  console.log('🔧 Setting auth token...');
  await page.setCookie(...cookie); //Set cookie

  console.log('⏰ Setting timeouts...');
  await page.setDefaultNavigationTimeout(process.env.timeout || 0);
  await page.setDefaultTimeout(process.env.timeout || 0);

  if (proxyAuth) {
    await page.setExtraHTTPHeaders({
      'Proxy-Authorization': 'Basic ' + Buffer.from(proxyAuth).toString('base64')
    })
  }

  return {
    browser,
    page
  };
}


async function clickWhenExist(page, query) {
  let result = await queryOnWebsite(page, query);

  try {
    if (result[0].type === 'tag' && result[0].name === 'button') {
      await page.click(query);
      await page.waitFor(500);
    }
  } catch (e) {}
}



async function queryOnWebsite(page, query) {
  let bodyHTML = await page.evaluate(() => document.body.innerHTML);
  let $ = cheerio.load(bodyHTML);
  const jquery = $(query);
  return jquery;
}



async function cleanup(browser, page) {
  const pages = await browser.pages();
  await pages.map((page) => page.close());
  await treekill(browser.process().pid, 'SIGKILL');
  //await browser.close();
  return await spawnBrowser();
}



async function killBrowser(browser, page) {
  const pages = await browser.pages();
  await pages.map((page) => page.close());
  treekill(browser.process().pid, 'SIGKILL');
}



async function shutDown() {
  console.log("\n👋Bye Bye👋");
  run = false;
  process.exit();
}



async function main() {
  console.clear();
  console.log("=========================");
  cookie = await readLoginData();
  var {
    browser,
    page
  } = await spawnBrowser();
  console.log("=========================");
  console.log('🔭 Running watcher...');
  await viewStreamer(browser, page);
}

(async () => {
  await main();
})();

process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);
