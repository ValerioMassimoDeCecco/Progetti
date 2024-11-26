chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "LOG_SITE") {
    const { url, title, timestamp } = message.data;

    // Recupera il log esistente dai dati locali
    chrome.storage.local.get({ siteLog: [] }, (result) => {
      const siteLog = result.siteLog;

      // Aggiungi il nuovo sito al log
      siteLog.push({ url, title, timestamp });

      // Salva nuovamente il log
      chrome.storage.local.set({ siteLog });

      console.log(`Sito loggato: ${url} - ${title} - ${timestamp}`);
    });
  }
});
