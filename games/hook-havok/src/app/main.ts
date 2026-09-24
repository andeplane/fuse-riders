const page = new URLSearchParams(location.search).has("showcase")
  ? import("./showcase.js")
  : import("./playground.js");
void page
  .then(() => {
    document.getElementById("boot-style")?.remove();
    document.getElementById("boot-status")?.remove();
  })
  .catch(() => {
    const status = document.getElementById("boot-status");
    if (!status) return;
    status.textContent = "The entrance could not load. Please try again.";
    const retry = document.createElement("button");
    retry.id = "retry-app";
    retry.textContent = "Retry loading";
    retry.onclick = () => location.reload();
    status.append(retry);
    document.querySelector("main")!.hidden = true;
  });
