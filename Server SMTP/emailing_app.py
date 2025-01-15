from flask import Flask, request
from flask_mail import Mail, Message

app = Flask(__name__)

# Configurazione del server SMTP
app.config['MAIL_SERVER'] = 'smtp.mailgun.org'
app.config['MAIL_PORT'] = 587
app.config['MAIL_USERNAME'] = 'postmaster@sandbox795c51c2aac34ffda8ce2e4ef84980d4.mailgun.org'
app.config['MAIL_PASSWORD'] = '9e4ce78320ee58b312c9f5c553d793f5-7113c52e-7f47cd41'
app.config['MAIL_USE_TLS'] = True
app.config['MAIL_USE_SSL'] = False

mail = Mail(app)

# Pagina principale con form per inviare email
html_form = '''
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Invio Email</title>
  </head>
  <body>
    <form action="/send_email" method="post">
      <label for="email">Email:</label>
      <input type="email" id="email" name="email" required><br>
      <label for="subject">Oggetto:</label>
      <input type="text" id="subject" name="subject" required><br>
      <label for="message">Messaggio:</label>
      <textarea id="message" name="message" required></textarea><br>
      <button type="submit">Invia</button>
    </form>
  </body>
</html>
'''

@app.route('/')
def index():
    return html_form

@app.route('/send_email', methods=['POST'])
def send_email():
    email = request.form['email']
    subject = request.form['subject']
    message = request.form['message']
    
    msg = Message(subject, sender='noreply@demo.com', recipients=[email])
    msg.body = message
    mail.send(msg)
    return 'Email inviata con successo'

if __name__ == '__main__':
    app.run(debug=True)
