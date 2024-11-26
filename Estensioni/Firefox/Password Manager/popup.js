const form = document.getElementById('password-form');
const passwordList = document.getElementById('password-list');
const searchInput = document.getElementById('search');
const message = document.getElementById('message');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const site = document.getElementById('site').value;
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

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
      <strong>${site}</strong> - ${username} - ${password}
      <button data-index="${index}" class="delete-button">Elimina</button>
    `;
    passwordList.appendChild(li);
  });

  document.querySelectorAll('.delete-button').forEach(button =>
    button.addEventListener('click', async (e) => {
      const index = e.target.getAttribute('data-index');
      passwords.splice(index, 1);
      await browser.storage.local.set({ passwords });
      showMessage("Credenziale eliminata.");
      renderPasswords(filter);
    })
  );
}

searchInput.addEventListener('input', () => {
  const filter = searchInput.value;
  renderPasswords(filter);
});

function showMessage(msg) {
  message.textContent = msg;
  message.classList.remove('hidden');
  setTimeout(() => message.classList.add('hidden'), 3000);
}

document.addEventListener('DOMContentLoaded', () => renderPasswords());
