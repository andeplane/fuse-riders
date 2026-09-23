if (new URLSearchParams(location.search).has("showcase"))
  void import("./showcase.js");
else void import("./playground.js");
