using System;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

class Server
{
    private const int MAX_CLIENTS = 10;
    private static TcpListener? _listener;
    private static TcpClient?[] _clients = new TcpClient?[MAX_CLIENTS];
    private static (float x, float y, float z, float rotationY)[] _playerStates = new (float, float, float, float)[MAX_CLIENTS];
    private static bool[] _clientActive = new bool[MAX_CLIENTS];
    private static object _lock = new object();

    static void Main()
    {
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] Server initializing...");
        
        try
        {
            _listener = new TcpListener(IPAddress.Any, 3000);
            _listener.Start();
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] Server started on port 3000. Max clients: {MAX_CLIENTS}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] [ERROR] Failed to start server: {ex.Message}");
            return;
        }

        while (true)
        {
            TcpClient client = _listener.AcceptTcpClient();
            int playerId = -1;
            lock (_lock)
            {
                playerId = FindAvailableSlot();
                if (playerId == -1)
                {
                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] [CONNECTION] Maximum clients reached. Disconnected new client.");
                    client.Close();
                    continue;
                }

                _clients[playerId] = client;
                _clientActive[playerId] = true;
                _playerStates[playerId] = (0f, 0f, 0f, 0f);
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] [CONNECTION] New client connected. Assigned ID: {playerId}. Active clients: {GetActiveCount()}");
            }

            Thread clientThread = new Thread(HandleClient);
            clientThread.Start(Tuple.Create(client, playerId));
        }
    }

    private static int FindAvailableSlot()
    {
        for (int i = 0; i < MAX_CLIENTS; i++)
        {
            if (!_clientActive[i]) return i;
        }
        return -1;
    }

    private static int GetActiveCount()
    {
        int count = 0;
        for (int i = 0; i < MAX_CLIENTS; i++)
        {
            if (_clientActive[i]) count++;
        }
        return count;
    }

    private static void HandleClient(object obj)
{
    var data = (Tuple<TcpClient, int>)obj;
    TcpClient client = data.Item1;
    int playerId = data.Item2;
    NetworkStream stream = client.GetStream();

    Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] [CLIENT {playerId}] Thread started.");

    SendInitMessage(client, playerId);
    BroadcastSpawnMessage(playerId);
    SendExistingStates(client, playerId);

    byte[] buffer = new byte[4096];
    List<byte> fullData = new List<byte>();
    int expectedLength = -1;

    while (true)
    {
        try
        {
            int bytesRead = stream.Read(buffer, 0, buffer.Length);
            if (bytesRead == 0) break;

            fullData.AddRange(buffer.Take(bytesRead));

            while (true)
            {
                // Estrazione lunghezza messaggio
                if (expectedLength == -1 && fullData.Count >= 4)
                {
                    byte[] lengthBytes = fullData.Take(4).ToArray();
                    expectedLength = BitConverter.ToInt32(lengthBytes, 0);
                    fullData.RemoveRange(0, 4);
                }

                // Estrazione payload completo
                if (expectedLength != -1 && fullData.Count >= expectedLength)
                {
                    byte[] messageBytes = fullData.Take(expectedLength).ToArray();
                    fullData.RemoveRange(0, expectedLength);
                    string message = Encoding.UTF8.GetString(messageBytes);
                    expectedLength = -1;

                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] [CLIENT {playerId}] Received: {message}");

                    // Processa UPDATE
                    if (message.StartsWith("UPDATE/"))
                    {
                        string[] parts = message.Split('/');
                        if (parts.Length >= 6)
                        {
                            int id = int.Parse(parts[1]);
                            float x = float.Parse(parts[2]);
                            float y = float.Parse(parts[3]);
                            float z = float.Parse(parts[4]);
                            float ry = float.Parse(parts[5]);

                            lock (_lock)
                            {
                                _playerStates[id] = (x, y, z, ry);
                            }
                        }
                    }

                    // Inoltra SOLO il payload (senza prefisso originale)
                    Broadcast(message); 
                }
                else
                {
                    break;
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] [CLIENT {playerId}] Error: {ex.Message}");
            break;
        }
    }

        lock (_lock)
        {
            _clients[playerId] = null;
            _clientActive[playerId] = false;
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] [DISCONNECTION] Client {playerId} disconnected. Active clients: {GetActiveCount()}");
        }

        Broadcast($"DESPAWN/{playerId}");
        client.Close();
    }

    private static void SendInitMessage(TcpClient client, int playerId)
    {
        var state = _playerStates[playerId];
        string initMessage = $"INIT/{playerId}/{state.x}/{state.y}/{state.z}/{state.rotationY}";
        SendWithLength(client, initMessage);
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] [CLIENT {playerId}] Sent INIT message: {initMessage}");
    }

    private static void BroadcastSpawnMessage(int playerId)
    {
        var state = _playerStates[playerId];
        string spawnMessage = $"SPAWN/{playerId}/{state.x}/{state.y}/{state.z}/{state.rotationY}";
        Broadcast(spawnMessage);
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] [BROADCAST] Sent SPAWN message for client {playerId}");
    }

    private static void SendExistingStates(TcpClient client, int currentId)
    {
        for (int i = 0; i < MAX_CLIENTS; i++)
        {
            if (i != currentId && _clientActive[i])
            {
                var state = _playerStates[i];
                string existingState = $"SPAWN/{i}/{state.x}/{state.y}/{state.z}/{state.rotationY}";
                SendWithLength(client, existingState);
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] [CLIENT {currentId}] Sent existing player {i} state");
            }
        }
    }

    private static void SendWithLength(TcpClient client, string message)
    {
        byte[] data = Encoding.UTF8.GetBytes(message);
        byte[] lengthPrefix = BitConverter.GetBytes(data.Length);
        byte[] fullMessage = new byte[4 + data.Length];
        Buffer.BlockCopy(lengthPrefix, 0, fullMessage, 0, 4);
        Buffer.BlockCopy(data, 0, fullMessage, 4, data.Length);

        try
        {
            client.GetStream().Write(fullMessage, 0, fullMessage.Length);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] [SEND] Sent message to client {client.GetHashCode()}: {message}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] [ERROR] Failed to send to client {client.GetHashCode()}: {ex.Message}");
        }
    }

    private static void Broadcast(string message)
    {
        lock (_lock)
        {
            for (int i = 0; i < MAX_CLIENTS; i++)
            {
                if (_clients[i] != null && _clientActive[i])
                {
                    SendWithLength(_clients[i]!, message);
                }
            }
        }
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] [BROADCAST] Forwarded message to all clients: {message}");
    }
}