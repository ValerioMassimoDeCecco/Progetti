browser.runtime.onMessage.addListener(async (message, sender) => {
  if (message.type === "SAVE_CREDENTIALS") {
    const { url, username, password } = message.data;

    const save = confirm(`Vuoi salvare queste credenziali?\nSito: ${url}\nUsername: ${username}`);
    if (save) {
      const storage = await browser.storage.local.get("passwords");
      const passwords = storage.passwords || [];
      passwords.push({ site: url, username, password });
      await browser.storage.local.set({ passwords });
      alert("Credenziali salvate con successo!");
    }
  }
});
