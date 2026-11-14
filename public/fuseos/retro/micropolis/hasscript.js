// Marks the page as script capable (was an inline script upstream; inline scripts are blocked by CSP).
[].forEach.call(document.querySelectorAll('[data-hasscript]'), function (elem) {
  elem.setAttribute('data-hasscript', 'true');
});
