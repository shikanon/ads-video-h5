// Explicit test-process preload only. The shipped server has no provider URL
// override or client-supplied identity shortcut.
const provider = process.env.QINGJIAN_TEST_WECHAT_PROVIDER;
if (!provider || !/^http:\/\/127\.0\.0\.1:\d+$/.test(provider)) throw new Error('WeChat fixture requires a loopback provider.');
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  return nativeFetch(url.origin === 'https://api.weixin.qq.com' && url.pathname === '/sns/jscode2session'
    ? provider + '/wechat-session' + url.search : input, init);
};
