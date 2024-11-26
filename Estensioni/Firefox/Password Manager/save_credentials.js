const params = new URLSearchParams(window.location.search);
const site = params.get("site");
const username = params.get("username");
const password = params.get("password");

document.getElementById("details").textContent = `Sito: ${site}\nUsername: ${username}`;

document.getElementById("save").addEventListener("click", async () => {
  const storage = await browser.storage.local.get("passwords");
  const passwords = storage.passwords || [];
  passwords.push({ site, username, password });
  await browser.storage.local.set({ passwords });
  alert("Credenziali salvate con successo!");
  window.close();
});

document.getElementById("cancel").addEventListener("click", () => {
  window.close();
});
