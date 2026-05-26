/** Apply saved language to <html> before paint (no dependencies). */
(function () {
  var l;
  try {
    l = localStorage.getItem('md3-lang');
  } catch (_) {}
  if (l !== 'fr' && l !== 'en' && l !== 'ar') return;
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
})();
