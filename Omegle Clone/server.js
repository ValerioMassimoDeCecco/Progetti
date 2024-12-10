const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // Importa il modulo uuid per generare ID unici

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
    const chatID = uuidv4(); // Genera un nuovo ID unico per ogni connessione
    const client = { ws, chatID, ip };

    clients.push(client);

    ws.send(JSON.stringify({ type: 'chatID', chatID }));

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
        }
    });

    ws.on('close', () => {
        clients = clients.filter(c => c.ws !== ws);
        if (ws.peer) {
            ws.peer.peer = null;
            ws.peer.ws.send(JSON.stringify({ type: 'peerDisconnected' }));
        }
    });
});

function matchClient(client) {
    const availableClients = clients.filter(c => c.ws !== client.ws && !c.ws.peer);
    if (availableClients.length > 0) {
        const peerClient = availableClients[0];
        client.ws.peer = peerClient;
        peerClient.ws.peer = client;
        client.chatID = client.chatID;
        peerClient.chatID = peerClient.chatID;

        client.ws.send(JSON.stringify({ type: 'matchSuccess', chatID: client.chatID }));
        peerClient.ws.send(JSON.stringify({ type: 'matchSuccess', chatID: peerClient.chatID }));
    } else {
        client.ws.send(JSON.stringify({ type: 'matchPending' }));
    }
}

function saveMessage(chatID, ip, message) {
    const directory = path.join(__dirname, 'database');
    const filePath = path.join(directory, `${chatID}.txt`);

    // Creare la directory se non esiste
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
