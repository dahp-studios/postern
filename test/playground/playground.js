// Shows, for each field, what Postern put there and which events the page saw.

const MAX_PREVIEW = 300;

function describe(value, masked) {
  if (!value) return "empty";
  const shown = masked ? "•".repeat(Math.min(value.length, 40)) : value.slice(0, MAX_PREVIEW);
  const more = !masked && value.length > MAX_PREVIEW ? "…" : "";
  return `${value.length} chars: ${shown}${more}`;
}

function watch(card) {
  const field = card.querySelector("input:not([type=file]), textarea, [contenteditable]");
  if (!field) return;
  const counts = { input: 0, change: 0 };
  const status = document.createElement("div");
  status.className = "status";
  const value = document.createElement("div");
  value.className = "value";
  card.append(status, value);

  let reveal = false;
  const isPassword = field.type === "password";
  if (isPassword) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = "Show";
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      reveal = !reveal;
      toggle.textContent = reveal ? "Hide" : "Show";
      render();
    });
    card.append(toggle);
  }

  const read = () => (field.isContentEditable ? field.textContent : field.value);

  function render() {
    status.textContent = `input events: ${counts.input} · change events: ${counts.change}`;
    status.classList.toggle("ok", counts.input > 0 && counts.change > 0 && read() !== "");
    value.textContent = describe(read(), isPassword && !reveal);
  }

  for (const type of Object.keys(counts)) {
    field.addEventListener(type, () => {
      counts[type] += 1;
      render();
    });
  }
  card.reset = () => {
    counts.input = counts.change = 0;
    if (field.isContentEditable) field.textContent = "";
    else if (!field.readOnly && !field.disabled) field.value = "";
    render();
  };
  render();
}

document.querySelectorAll(".card").forEach(watch);

document.getElementById("reset")?.addEventListener("click", () => {
  document.querySelectorAll(".card").forEach((c) => c.reset?.());
  for (const frame of document.querySelectorAll("iframe")) {
    frame.contentDocument?.querySelectorAll(".card").forEach((c) => c.reset?.());
  }
  const fileInput = document.getElementById("check-file");
  fileInput.value = "";
  document.getElementById("file-report").hidden = true;
  document.getElementById("f-preview").hidden = true;
});

const TEXT_LIKE = /^(text\/|application\/(json|xml|x-yaml|yaml))|\.(json|txt|csv|ya?ml|xml|env|md)$/i;

document.getElementById("check-file")?.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  document.getElementById("f-name").textContent = file.name;
  document.getElementById("f-size").textContent = `${bytes.length.toLocaleString()} bytes`;
  document.getElementById("f-type").textContent = file.type || "unknown";
  document.getElementById("f-hash").textContent = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
  document.getElementById("file-report").hidden = false;

  const preview = document.getElementById("f-preview");
  if (TEXT_LIKE.test(file.type) || TEXT_LIKE.test(file.name)) {
    const text = new TextDecoder().decode(bytes);
    preview.textContent = text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
    preview.hidden = false;
  } else {
    preview.hidden = true;
  }
});
