from flask import Flask, request, render_template_string, send_from_directory, redirect, url_for
import os
from scapy.all import ARP, Ether, srp

app = Flask(__name__)
UPLOAD_FOLDER = './uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

def get_connected_devices():
    ip_range = '192.168.1.1/24'  # Modifica questo range in base alla tua rete
    arp_request = ARP(pdst=ip_range)
    ether = Ether(dst="ff:ff:ff:ff:ff:ff")
    packet = ether/arp_request
    result = srp(packet, timeout=2, verbose=False)[0]

    devices = []
    for sent, received in result:
        devices.append({'ip': received.psrc, 'mac': received.hwsrc})

    return devices

def get_file_info():
    files = []
    for filename in os.listdir(UPLOAD_FOLDER):
        file_path = os.path.join(UPLOAD_FOLDER, filename)
        file_size_mb = os.path.getsize(file_path) / (1024 * 1024)  # Converti byte in MB
        files.append({'name': filename, 'size': f"{file_size_mb:.2f} MB"})
    return files

@app.route('/')
def home():
    devices = get_connected_devices()
    files = get_file_info()
    return render_template_string('''
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0-alpha1/dist/css/bootstrap.min.css" rel="stylesheet">
            <title>File Transfer</title>
            <style>
                body {
                    background-color: #121212;
                    color: #ffffff;
                }
                .container {
                    margin-top: 50px;
                }
                .progress {
                    display: none;
                    margin-top: 10px;
                }
                .card {
                    background-color: #1e1e1e;
                    border: 1px solid #333;
                }
                .btn-primary {
                    background-color: #4caf50;
                    border: none;
                }
                .btn-danger {
                    background-color: #f44336;
                    border: none;
                }
                .btn-success {
                    background-color: #00b894;
                    border: none;
                }
                a {
                    color: #00b894;
                    text-decoration: none;
                }
                a:hover {
                    color: #81ecec;
                }
                .list-group-item {
                    background-color: #2e2e2e;
                    color: #ffffff;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1 class="text-center">File Transfer</h1>

                <div class="card mt-5">
                    <div class="card-body">
                        <h2>Upload a file</h2>
                        <form id="uploadForm" method="POST" action="/upload" enctype="multipart/form-data">
                            <div class="mb-3">
                                <input class="form-control" type="file" name="file" id="fileInput" required>
                            </div>
                            <button class="btn btn-primary" type="submit">Upload</button>
                        </form>

                        <div class="progress mt-3">
                            <div class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: 0%;" id="progressBar"></div>
                        </div>

                        <div id="uploadStatus" class="mt-3"></div>
                    </div>
                </div>

                <div class="card mt-5">
                    <div class="card-body">
                        <h2>Download and Delete Files</h2>
                        <ul class="list-group">
                        {% for file in files %}
                            <li class="list-group-item d-flex justify-content-between align-items-center">
                                <span>{{ file.name }} ({{ file.size }})</span>
                                <div>
                                    <a href="{{ url_for('uploaded_file', filename=file.name) }}" class="btn btn-success btn-sm me-2" download>Download</a>
                                    <form method="POST" action="/delete/{{ file.name }}" style="display:inline;">
                                        <button class="btn btn-danger btn-sm" type="submit">Delete</button>
                                    </form>
                                </div>
                            </li>
                        {% endfor %}
                        </ul>
                    </div>
                </div>

                <div class="card mt-5">
                    <div class="card-body">
                        <h2>Connected Devices</h2>
                        <ul class="list-group">
                        {% for device in devices %}
                            <li class="list-group-item">
                                IP: {{ device.ip }} - MAC: {{ device.mac }}
                            </li>
                        {% endfor %}
                        </ul>
                    </div>
                </div>
            </div>

            <script>
                const uploadForm = document.getElementById('uploadForm');
                const progressBar = document.getElementById('progressBar');
                const progressContainer = document.querySelector('.progress');
                const uploadStatus = document.getElementById('uploadStatus');

                uploadForm.addEventListener('submit', function(event) {
                    event.preventDefault();
                    const fileInput = document.getElementById('fileInput');
                    const file = fileInput.files[0];

                    if (!file) {
                        uploadStatus.innerHTML = '<div class="alert alert-danger">Please select a file.</div>';
                        return;
                    }

                    const formData = new FormData();
                    formData.append('file', file);

                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', '/upload', true);

                    xhr.upload.onprogress = function(event) {
                        if (event.lengthComputable) {
                            const percentComplete = (event.loaded / event.total) * 100;
                            progressBar.style.width = percentComplete + '%';
                            progressBar.textContent = Math.round(percentComplete) + '%';
                            progressContainer.style.display = 'block';
                        }
                    };

                    xhr.onload = function() {
                        if (xhr.status === 200) {
                            uploadStatus.innerHTML = '<div class="alert alert-success">File uploaded successfully!</div>';
                            progressBar.style.width = '0%';
                            progressBar.textContent = '0%';
                            progressContainer.style.display = 'none';
                            setTimeout(() => {
                                location.reload();
                            }, 1000);
                        } else {
                            uploadStatus.innerHTML = '<div class="alert alert-danger">Error uploading file.</div>';
                        }
                    };

                    xhr.send(formData);
                });
            </script>
        </body>
        </html>
    ''', files=get_file_info(), devices=devices)

@app.route('/upload', methods=['POST'])
def upload_file():
    file = request.files['file']
    if file:
        file.save(os.path.join(UPLOAD_FOLDER, file.filename))
    return 'File uploaded successfully!'

@app.route('/delete/<filename>', methods=['POST'])
def delete_file(filename):
    file_path = os.path.join(UPLOAD_FOLDER, filename)
    if os.path.exists(file_path):
        os.remove(file_path)
    return redirect(url_for('home'))

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
