from flask import Flask, render_template, request, redirect, session, url_for, flash
from html import escape  # Add this import
from threading import Thread
import queue
import os

app = Flask(__name__)
app.secret_key = 'chiave_segreta'

DB_FILE = 'db.txt'
CHATS_DIR = 'chats'

chat_streams = {}

if not os.path.exists(CHATS_DIR):
    os.makedirs(CHATS_DIR)

def load_users():
    users = {}
    if os.path.exists(DB_FILE):
        with open(DB_FILE, 'r') as file:
            for line in file:
                username, password = line.strip().split(' : ')
                users[username] = password
    return users

def save_user(username, password):
    with open(DB_FILE, 'a') as file:
        file.write(f"{username} : {password}\n")

def get_chat_file(user1, user2):
    return os.path.join(CHATS_DIR, f"{min(user1, user2)}_{max(user1, user2)}.txt")

# Modify the load_chat function in app.py
def load_chat(user1, user2):
    chat_file = get_chat_file(user1, user2)
    if os.path.exists(chat_file):
        with open(chat_file, 'r') as file:
            # Escape HTML to prevent XSS
            return [escape(line.strip()) for line in file]
    return []

def save_message(user1, user2, sender, message):
    chat_file = get_chat_file(user1, user2)
    with open(chat_file, 'a') as file:
        file.write(f"{sender}: {message}\n")
    
    # Notify any listeners about the new message
    key = f"{min(user1, user2)}_{max(user1, user2)}"
    if key in chat_streams:
        chat_streams[key].put({
            'sender': sender, 
            'message': escape(message)
        })



def get_chat_updates(user1, user2):
    """Create a queue for chat updates between two users"""
    key = f"{min(user1, user2)}_{max(user1, user2)}"
    if key not in chat_streams:
        chat_streams[key] = queue.Queue()
    return chat_streams[key]

@app.route('/')
def home():
    if 'username' in session:
        return redirect(url_for('search'))
    return redirect(url_for('login'))

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        users = load_users()
        if username in users:
            flash('Username già esistente!')
            return redirect(url_for('register'))
        save_user(username, password)
        flash('Registrazione completata!')
        return redirect(url_for('login'))
    return render_template('register.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        users = load_users()
        
        if username in users and users[username] == password:
            # Standard session login
            session['username'] = username
            
            # Check if "Remember Me" is selected
            if request.form.get('remember'):
                # Create a response with a persistent cookie
                resp = make_response(redirect(url_for('search')))
                # URL encode the credentials to handle special characters
                encoded_credentials = quote(f"{username}:{password}")
                resp.set_cookie('remembered_user', encoded_credentials, 
                                expires=datetime.now() + timedelta(days=365), 
                                httponly=True, 
                                secure=False)  # Set to True in production with HTTPS
                return resp
            
            return redirect(url_for('search'))
        
        flash('Username o password errati!')
    
    # Check for existing remember me cookie
    remembered_cookie = request.cookies.get('remembered_user')
    if remembered_cookie:
        try:
            # URL decode the credentials
            decoded_credentials = unquote(remembered_cookie)
            username, password = decoded_credentials.split(':')
            users = load_users()
            if username in users and users[username] == password:
                session['username'] = username
                return redirect(url_for('search'))
        except (ValueError, Exception):
            # Invalid cookie format
            pass
    
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.pop('username', None)
    # Clear the remember me cookie
    resp = make_response(redirect(url_for('login')))
    resp.set_cookie('remembered_user', '', expires=0)
    return resp


@app.route('/search', methods=['GET', 'POST'])
def search():
    if 'username' not in session:
        return redirect(url_for('login'))
    users = load_users()
    query = request.form.get('query', '').strip() if request.method == 'POST' else ''
    results = [user for user in users if query.lower() in user.lower() and user != session['username']]
    return render_template('search.html', results=results, query=query)

@app.route('/chat_stream/<username>')
def chat_stream(username):
    if 'username' not in session:
        return Response(status=403)
    
    def event_stream():
        updates = get_chat_updates(session['username'], username)
        while True:
            message = updates.get()
            yield f"data: {json.dumps(message)}\n\n"
    
    return Response(event_stream(), mimetype='text/event-stream')

@app.route('/chat/<username>', methods=['GET', 'POST'])
def chat(username):
    if 'username' not in session:
        return redirect(url_for('login'))
    if request.method == 'POST':
        message = request.form['message'].strip()
        if message:
            save_message(session['username'], username, session['username'], message)
    chat_history = load_chat(session['username'], username)
    return render_template('chat.html', username=username, chat_history=chat_history)

if __name__ == '__main__':
    app.run(debug=True)