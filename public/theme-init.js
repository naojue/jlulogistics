(function () {
  var preference = "system";
  try {
    var saved = localStorage.getItem("jida-theme");
    if (saved === "light" || saved === "dark") preference = saved;
  } catch (_) {}
  var dark =
    preference === "dark" ||
    (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
