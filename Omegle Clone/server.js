const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const geoip = require('geoip-lite');

const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
        let filePath = '.' + req.url;
        if (filePath === './') {
            filePath = './index.html';
        }

        const extname = path.extname(filePath);
        let contentType = 'text/html';
        switch (extname) {
            case '.js':
                contentType = 'text/javascript';
                break;
            case '.css':
                contentType = 'text/css';
                break;
            case '.mp3':
                contentType = 'audio/mpeg';
                break;
        }

        fs.readFile(filePath, (error, content) => {
            if (error) {
                if (error.code === 'ENOENT') {
                    fs.readFile('./404.html', (error, content) => {
                        res.writeHead(404, { 'Content-Type': 'text/html' });
                        res.end(content, 'utf-8');
                    });
                } else {
                    res.writeHead(500);
                    res.end(`Sorry, check with the site admin for error: ${error.code} ..\n`);
                    res.end();
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            }
        });
    }
});

const wss = new WebSocket.Server({ server });

let clients = [];

wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    const chatID = uuidv4();
    const geo = geoip.lookup(ip);
    const country = geo ? geo.country : 'Unknown';
    const client = { ws, chatID, ip, country };

    clients.push(client);

    ws.send(JSON.stringify({ type: 'chatID', chatID }));
    broadcastUserCount();

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.type === 'match') {
            matchClient(client);
        } else if (data.type === 'message') {
            const peer = ws.peer;
            if (peer) {
                saveMessage(chatID, ip, data.message);
                saveMessage(peer.chatID, peer.ip, data.message);
                peer.ws.send(JSON.stringify({ type: 'message', message: data.message }));
            }
        } else if (data.type === 'audio') {
            const peer = ws.peer;
            if (peer) {
                saveAudio(chatID, ip, data.audio);
                saveAudio(peer.chatID, peer.ip, data.audio);
                peer.ws.send(JSON.stringify({ type: 'audio', audio: data.audio }));
            }
        } else if (data.type === 'image') {
            const peer = ws.peer;
            if (peer) {
                saveMedia(chatID, ip, data.image, 'image');
                peer.ws.send(JSON.stringify({ type: 'image', image: data.image }));
            }
        } else if (data.type === 'video') {
            const peer = ws.peer;
            if (peer) {
                saveMedia(chatID, ip, data.video, 'video');
                peer.ws.send(JSON.stringify({ type: 'video', video: data.video }));
            }
        }
    });

    ws.on('close', () => {
        clients = clients.filter(c => c.ws !== ws);
        if (ws.peer) {
            ws.peer.peer = null;
            ws.peer.ws.send(JSON.stringify({ type: 'peerDisconnected' }));
        }
        broadcastUserCount();
    });
});

function broadcastUserCount() {
    const userCount = clients.length;
    clients.forEach(client => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({ type: 'updateUserCount', count: userCount }));
        }
    });
}

function matchClient(client) {
    const availableClients = clients.filter(c => c.ws !== client.ws && !c.ws.peer);
    if (availableClients.length > 0) {
        const peerClient = availableClients[0];

        client.ws.peer = peerClient;
        peerClient.ws.peer = client;

        client.ws.send(JSON.stringify({ 
            type: 'matchSuccess', 
            chatID: client.chatID, 
            peerCountry: peerClient.country 
        }));
        peerClient.ws.send(JSON.stringify({ 
            type: 'matchSuccess', 
            chatID: peerClient.chatID, 
            peerCountry: client.country 
        }));
    } else {
        client.ws.send(JSON.stringify({ type: 'matchPending' }));
    }
}

function saveMessage(chatID, ip, message) {
    const directory = path.join(__dirname, 'database');
    const filePath = path.join(directory, `${chatID}.txt`);

    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory);
    }

    const logMessage = `${ip} : ${message}\n`;
    fs.appendFile(filePath, logMessage, err => {
        if (err) {
            console.error('Error saving message:', err);
        }
    });
}

function saveAudio(chatID, ip, audio) {
    const directory = path.join(__dirname, 'database');
    const filePath = path.join(directory, `${chatID}-${Date.now()}.mp3`);

    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory);
    }

    fs.writeFile(filePath, Buffer.from(audio, 'base64'), (err) => {
        if (err) {
            console.error('Error saving audio:', err);
        }
    });
}

function saveMedia(chatID, ip, media, mediaType) {
    const directory = path.join(__dirname, 'database');
    const filePath = path.join(directory, `${chatID}-${Date.now()}.${mediaType === 'image' ? 'jpg' : 'mp4'}`);

    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory);
    }

    fs.writeFile(filePath, Buffer.from(media, 'base64'), (err) => {
        if (err) {
            console.error(`Error saving ${mediaType}:`, err);
        }
    });
}

const PORT = 8080;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
    const interfaces = require('os').networkInterfaces();
    console.log(`Server listening on:`);
    Object.keys(interfaces).forEach((iface) => {
        interfaces[iface].forEach((details) => {
            if (details.family === 'IPv4') {
                console.log(`  http://${details.address}:${PORT}`);
            }
        });
    });
});
