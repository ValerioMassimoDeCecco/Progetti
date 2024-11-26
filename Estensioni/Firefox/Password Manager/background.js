chrome.runtime.onInstalled.addListener(() => {
  console.log("Password Manager è stato installato.");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SAVE_CREDENTIALS") {
    const { url, username, password } = message.data;
    // Logica per salvare le credenziali
    console.log(`Salvando le credenziali per ${url}`);
    // Usa chrome.storage per memorizzare i dati
    chrome.storage.local.get({ passwords: [] }, (result) => {
      const passwords = result.passwords;
      passwords.push({ site: url, username, password });
      chrome.storage.local.set({ passwords });
    });
  }
});
