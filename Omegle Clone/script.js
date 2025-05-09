const startButton = document.getElementById('startButton');
const loadingDiv = document.getElementById('loading');
const chatDiv = document.getElementById('chat');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const closeButton = document.getElementById('closeButton');
const recordButton = document.getElementById('recordButton');
const recordingStatus = document.getElementById('recordingStatus');
const userCountDiv = document.getElementById('userCount');

// Image and video input elements
const imageInput = document.createElement('input');
imageInput.type = 'file';
imageInput.accept = 'image/*';
imageInput.style.display = 'none';
document.body.appendChild(imageInput);

const videoInput = document.createElement('input');
videoInput.type = 'file';
videoInput.accept = 'video/*';
videoInput.style.display = 'none';
document.body.appendChild(videoInput);

const sendImageButton = document.createElement('button');
sendImageButton.textContent = 'Send Image';
chatDiv.appendChild(sendImageButton);

const sendVideoButton = document.createElement('button');
sendVideoButton.textContent = 'Send Video';
chatDiv.appendChild(sendVideoButton);

let socket;
let chatID = '';
let mediaRecorder;
let audioChunks = [];

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

recordButton.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'inactive') {
        mediaRecorder.start();
        recordButton.textContent = 'Stop Recording';
        recordingStatus.style.display = 'block';
    } else if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        recordButton.textContent = 'Record Voice Message';
        recordingStatus.style.display = 'none';
    }
});

// Add event listeners for image and video buttons
sendImageButton.addEventListener('click', () => imageInput.click());
sendVideoButton.addEventListener('click', () => videoInput.click());

imageInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64data = reader.result.split(',')[1];
            socket.send(JSON.stringify({ type: 'image', image: base64data }));
            addImage(base64data);
        };
        reader.readAsDataURL(file);
    }
});

videoInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64data = reader.result.split(',')[1];
            socket.send(JSON.stringify({ type: 'video', video: base64data }));
            addVideo(base64data);
        };
        reader.readAsDataURL(file);
    }
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
            addMessage(`You are now chatting with a random stranger from ${data.peerCountry}. Your Chat ID: ${chatID}`, 'system');
        } else if (data.type === 'peerDisconnected') {
            addMessage('Your partner has disconnected.', 'system');
        } else if (data.type === 'message') {
            addMessage(`${data.message}`, 'received');
        } else if (data.type === 'audio') {
            addAudio(data.audio);
        } else if (data.type === 'image') {
            addImage(data.image);
        } else if (data.type === 'video') {
            addVideo(data.video);
        } else if (data.type === 'updateUserCount') {
            userCountDiv.textContent = `Utenti connessi: ${data.count}`;
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

    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            mediaRecorder = new MediaRecorder(stream);

            mediaRecorder.addEventListener('dataavailable', event => {
                audioChunks.push(event.data);
                if (mediaRecorder.state === 'inactive') {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/mp3' });
                    audioChunks = [];

                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const base64data = reader.result.split(',')[1];
                        socket.send(JSON.stringify({ type: 'audio', audio: base64data }));
                        addAudio(base64data);
                    };
                    reader.readAsDataURL(audioBlob);
                }
            });
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
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function addAudio(base64data) {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = 'data:audio/mp3;base64,' + base64data;
        const messageElem = document.createElement('div');
        messageElem.classList.add('message', 'audio');
        messageElem.appendChild(audio);
        messagesDiv.appendChild(messageElem);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function addImage(base64data) {
        const image = document.createElement('img');
        image.src = 'data:image/jpeg;base64,' + base64data;
        const messageElem = document.createElement('div');
        messageElem.classList.add('message', 'image');
        messageElem.appendChild(image);
        messagesDiv.appendChild(messageElem);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function addVideo(base64data) {
        const video = document.createElement('video');
        video.controls = true;
        video.src = 'data:video/mp4;base64,' + base64data;
        const messageElem = document.createElement('div');
        messageElem.classList.add('message', 'video');
        messageElem.appendChild(video);
        messagesDiv.appendChild(messageElem);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
}
