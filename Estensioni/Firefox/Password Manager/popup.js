const form = document.getElementById('password-form');
const passwordList = document.getElementById('password-list');
const searchInput = document.getElementById('search');
const message = document.getElementById('message');
const showPasswordCheckbox = document.getElementById('show-password');
const passwordInput = document.getElementById('password');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const site = document.getElementById('site').value;
  const username = document.getElementById('username').value;
  const password = passwordInput.value;

  const newEntry = { site, username, password };
  const storage = await browser.storage.local.get('passwords');
  const passwords = storage.passwords || [];
  passwords.push(newEntry);
  await browser.storage.local.set({ passwords });

  showMessage("Credenziale aggiunta con successo!");
  renderPasswords();
  form.reset();
});

async function renderPasswords(filter = '') {
  passwordList.innerHTML = '';
  const storage = await browser.storage.local.get('passwords');
  const passwords = storage.passwords || [];
  const filteredPasswords = passwords.filter(({ site }) =>
    site.toLowerCase().includes(filter.toLowerCase())
  );

  filteredPasswords.forEach(({ site, username, password }, index) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <strong>${site}</strong> - ${username}
      <button data-index="${index}" class="delete-button">Elimina</button>
      <button data-index="${index}" class="copy-button">Copia</button>
    `;
    passwordList.appendChild(li);

    // Gestione del clic per copiare la password
    const copyButton = li.querySelector('.copy-button');
    copyButton.addEventListener('click', () => {
      navigator.clipboard.writeText(password).then(() => {
        showMessage("Password copiata negli appunti.");
      }).catch(() => {
        showMessage("Errore nel copiare la password.");
      });
    });

    // Gestione del clic per eliminare
    const deleteButton = li.querySelector('.delete-button');
    deleteButton.addEventListener('click', async () => {
      const confirmed = confirm(`Sei sicuro di voler eliminare la credenziale per ${site}?`);
      if (confirmed) {
        passwords.splice(index, 1);
        await browser.storage.local.set({ passwords });
        showMessage("Credenziale eliminata.");
        renderPasswords(filter);
      }
    });

    // Cliccando sul sito, autocompleta i campi
    li.addEventListener('click', () => {
      document.getElementById('site').value = site;
      document.getElementById('username').value = username;
      document.getElementById('password').value = password;
    });
  });
}

searchInput.addEventListener('input', () => {
  const filter = searchInput.value;
  renderPasswords(filter);
});

showPasswordCheckbox.addEventListener('change', () => {
  if (showPasswordCheckbox.checked) {
    passwordInput.type = 'text';
  } else {
    passwordInput.type = 'password';
  }
});

function showMessage(msg) {
  message.textContent = msg;
  message.classList.remove('hidden');
  setTimeout(() => message.classList.add('hidden'), 3000);
}

document.addEventListener('DOMContentLoaded', () => renderPasswords());
