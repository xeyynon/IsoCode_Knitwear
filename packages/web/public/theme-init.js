/* Applies the saved theme before the first paint, so a person who chose dark never sees a white flash.
 * A classic script from the app's own address, loaded first in <head>: the Content-Security-Policy allows no inline script.
 * Light is the default. Dark is applied ONLY when the person chose it in the menu (localStorage orders.theme = 'dark');
 * the device's own dark setting is deliberately not read: the floor reads these screens in bright light and red, amber and
 * green must look the same on every phone. src/ui/theme.ts does the same job after the app starts, and keeps the two in step
 * (test/theme.test.tsx). The address-bar colour below is the dark --page token. */
(function () {
  try {
    if (window.localStorage.getItem('orders.theme') === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark')
      var meta = document.querySelector('meta[name="theme-color"]')
      if (meta) meta.setAttribute('content', '#15141B')
    }
  } catch (e) { /* storage blocked (a private window): stay light */ }
})()
