// Quando una nuova pagina viene caricata, invia l'URL al background
chrome.runtime.sendMessage({
  type: 'LOG_SITE',
  data: {
    url: window.location.href,
    title: document.title,
    timestamp: new Date().toISOString()
  }
});
