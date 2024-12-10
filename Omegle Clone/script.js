const startButton = document.getElementById('startButton');
const loadingDiv = document.getElementById('loading');
const chatDiv = document.getElementById('chat');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const closeButton = document.getElementById('closeButton');

let socket;
let chatID = '';

startButton.addEventListener('click', () => {
    startButton.style.display = 'none';
    loadingDiv.style.display = 'block';
    startChat();
});

closeButton.addEventListener('click', () => {
    if (socket) {
        socket.close();
    }
    chatDiv.style.display = 'none';
    startButton.style.display = 'block';
    messagesDiv.innerHTML = '';
});

function startChat() {
    socket = new WebSocket('ws://localhost:8080');

    socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'match' }));
    });

    socket.addEventListener('message', (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'chatID') {
            chatID = data.chatID;
            console.log('Your Chat ID:', chatID);
        } else if (data.type === 'matchSuccess') {
            loadingDiv.style.display = 'none';
            chatDiv.style.display = 'block';
            addMessage('You are now chatting with a random stranger. Your Chat ID: ' + chatID, 'system');
        } else if (data.type === 'peerDisconnected') {
            addMessage('Your partner has disconnected.', 'system');
        } else if (data.type === 'message') {
            addMessage(`Stranger: ${data.message}`, 'received');
        }
    });

    socket.addEventListener('close', () => {
        addMessage('Chat closed.', 'system');
        chatDiv.style.display = 'none';
        startButton.style.display = 'block';
        loadingDiv.style.display = 'none';
    });

    messageInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            const message = event.target.value;
            addMessage(`You: ${message}`, 'sent');
            socket.send(JSON.stringify({ type: 'message', message }));
            event.target.value = '';
        }
    });

    function addMessage(message, type) {
        const messageElem = document.createElement('div');
        messageElem.textContent = message;
        messageElem.classList.add('message');
        if (type === 'sent') {
            messageElem.classList.add('sent');
        } else if (type === 'received') {
            messageElem.classList.add('received');
        } else {
            messageElem.classList.add('system');
        }
        messagesDiv.appendChild(messageElem);
        messagesDiv.scrollTop = messagesDiv.scrollHeight; // Scrolla fino in fondo
    }
}
