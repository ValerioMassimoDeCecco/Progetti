document.addEventListener("submit", (e) => {
    const form = e.target;
    const url = window.location.origin;
    const username = form.querySelector('input[type="text"], input[type="email"]')?.value;
    const password = form.querySelector('input[type="password"]')?.value;
  
    if (username && password) {
      browser.runtime.sendMessage({
        type: "SAVE_CREDENTIALS",
        data: { url, username, password }
      });
    }
  });
  