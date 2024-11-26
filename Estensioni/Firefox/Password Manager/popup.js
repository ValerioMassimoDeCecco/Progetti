const form = document.getElementById('password-form');
const passwordList = document.getElementById('password-list');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const site = document.getElementById('site').value;
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  const data = { site, username, password };
  const storage = await browser.storage.local.get('passwords');
  const passwords = storage.passwords || [];
  passwords.push(data);
  await browser.storage.local.set({ passwords });

  renderPasswords();
  form.reset();
});

async function renderPasswords() {
  passwordList.innerHTML = '';
  const storage = await browser.storage.local.get('passwords');
  const passwords = storage.passwords || [];
  passwords.forEach(({ site, username, password }) => {
    const li = document.createElement('li');
    li.textContent = `${site} - ${username} - ${password}`;
    passwordList.appendChild(li);
  });
}

document.addEventListener('DOMContentLoaded', renderPasswords);
