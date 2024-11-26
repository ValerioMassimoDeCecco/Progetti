const form = document.getElementById('password-form');
const passwordList = document.getElementById('password-list');
const searchInput = document.getElementById('search');
const messageDiv = document.getElementById('message');

function renderPasswords(passwords) {
  passwordList.innerHTML = '';
  passwords.forEach((password, index) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span><strong>${password.site}</strong><br> 
        ${password.username} <br>
        <span class="password-display">${password.password}</span>
        <button class="copy-button" onclick="copyPassword('${password.password}')">Copia</button>
        <button class="delete-button" onclick="deletePassword(${index})">Elimina</button>
      </span>
    `;
    passwordList.appendChild(li);
  });
}

function copyPassword(password) {
  navigator.clipboard.writeText(password).then(() => {
    showMessage('Password copiata!');
  });
}

function deletePassword(index) {
  chrome.storage.local.get('passwords', (result) => {
    const passwords = result.passwords || [];
    passwords.splice(index, 1);
    chrome.storage.local.set({ passwords }, () => {
      showMessage('Password eliminata!');
      renderPasswords(passwords);
    });
  });
}

function showMessage(message) {
  messageDiv.textContent = message;
  messageDiv.classList.remove('hidden');
  setTimeout(() => {
    messageDiv.classList.add('hidden');
  }, 2000);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const site = document.getElementById('site').value;
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  const newEntry = { site, username, password };
  
  chrome.storage.local.get('passwords', (result) => {
    const passwords = result.passwords || [];
    passwords.push(newEntry);
    chrome.storage.local.set({ passwords }, () => {
      showMessage("Credenziale aggiunta con successo!");
      renderPasswords(passwords);
    });
  });
});

searchInput.addEventListener('input', (e) => {
  const searchQuery = e.target.value.toLowerCase();
  chrome.storage.local.get('passwords', (result) => {
    const passwords = result.passwords || [];
    const filteredPasswords = passwords.filter(password =>
      password.site.toLowerCase().includes(searchQuery) ||
      password.username.toLowerCase().includes(searchQuery)
    );
    renderPasswords(filteredPasswords);
  });
});

// Caricamento iniziale dei dati
chrome.storage.local.get('passwords', (result) => {
  const passwords = result.passwords || [];
  renderPasswords(passwords);
});
