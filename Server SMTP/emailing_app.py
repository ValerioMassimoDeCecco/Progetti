from flask import Flask, request
from flask_mail import Mail, Message

app = Flask(__name__)

app.config['MAIL_SERVER'] = 'smtp.mailgun.org'
app.config['MAIL_PORT'] = 587
app.config['MAIL_USERNAME'] = 'postmaster@sandbox795c51c2aac34ffda8ce2e4ef84980d4.mailgun.org'
app.config['MAIL_PASSWORD'] = '9e4ce78320ee58b312c9f5c553d793f5-7113c52e-7f47cd41'
app.config['MAIL_USE_TLS'] = True
app.config['MAIL_USE_SSL'] = False

mail = Mail(app)

html_form = '''
<!DOCTYPE html>
<html lang="it" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email System Pro</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    animation: {
                        'gradient': 'gradient 8s linear infinite',
                    },
                    keyframes: {
                        gradient: {
                            '0%, 100%': {
                                'background-size': '200% 200%',
                                'background-position': 'left center'
                            },
                            '50%': {
                                'background-size': '200% 200%',
                                'background-position': 'right center'
                            }
                        }
                    }
                }
            }
        }
    </script>
    <style>
        @keyframes float {
            0% { transform: translateY(0px); }
            50% { transform: translateY(-10px); }
            100% { transform: translateY(0px); }
        }
        .float-animation {
            animation: float 3s ease-in-out infinite;
        }
    </style>
</head>
<body class="h-full transition-colors duration-300 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-blue-900">
    <div class="fixed top-4 right-4">
        <button id="themeToggle" class="p-2 rounded-lg bg-white/30 dark:bg-gray-800/30 text-gray-800 dark:text-white transition-all hover:scale-110">
            <i class="fas fa-moon dark:hidden"></i>
            <i class="fas fa-sun hidden dark:block"></i>
        </button>
    </div>

    <div class="min-h-full flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div class="sm:mx-auto sm:w-full sm:max-w-md">
            <div class="text-center">
                <i class="fas fa-paper-plane text-5xl text-blue-500 dark:text-blue-400 mb-4 float-animation"></i>
                <h2 class="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-purple-600 dark:from-blue-400 dark:to-purple-500 animate-gradient">
                    Email System Pro
                </h2>
            </div>
        </div>

        <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
            <div class="bg-white/70 dark:bg-gray-800/70 backdrop-blur-lg py-8 px-4 shadow-2xl shadow-blue-500/10 dark:shadow-blue-400/10 sm:rounded-2xl sm:px-10 transform transition-all hover:scale-[1.01]">
                <form class="space-y-6" action="/send_email" method="POST" id="emailForm">
                    <div>
                        <label for="email" class="block text-sm font-medium text-gray-700 dark:text-gray-200">
                            Indirizzo Email
                        </label>
                        <div class="mt-1 relative rounded-md shadow-sm group">
                            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <i class="fas fa-at text-gray-400 group-focus-within:text-blue-500"></i>
                            </div>
                            <input type="email" name="email" id="email" required
                                class="focus:ring-2 focus:ring-blue-500 focus:border-blue-500 block w-full pl-10 sm:text-sm border-gray-300 dark:border-gray-600 rounded-lg bg-white/50 dark:bg-gray-700/50 dark:text-white transition-all"
                                placeholder="esempio@email.com">
                        </div>
                    </div>

                    <div>
                        <label for="subject" class="block text-sm font-medium text-gray-700 dark:text-gray-200">
                            Oggetto
                        </label>
                        <div class="mt-1 relative rounded-md shadow-sm group">
                            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <i class="fas fa-heading text-gray-400 group-focus-within:text-blue-500"></i>
                            </div>
                            <input type="text" name="subject" id="subject" required
                                class="focus:ring-2 focus:ring-blue-500 focus:border-blue-500 block w-full pl-10 sm:text-sm border-gray-300 dark:border-gray-600 rounded-lg bg-white/50 dark:bg-gray-700/50 dark:text-white transition-all"
                                placeholder="Inserisci l'oggetto">
                        </div>
                    </div>

                    <div>
                        <label for="message" class="block text-sm font-medium text-gray-700 dark:text-gray-200">
                            Messaggio
                        </label>
                        <div class="mt-1">
                            <textarea id="message" name="message" rows="4" required
                                class="focus:ring-2 focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 dark:border-gray-600 rounded-lg bg-white/50 dark:bg-gray-700/50 dark:text-white transition-all resize-none"
                                placeholder="Scrivi il tuo messaggio qui..."></textarea>
                        </div>
                    </div>

                    <div>
                        <button type="submit"
                            class="group relative w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-300 hover:scale-[1.02]">
                            <span class="absolute inset-y-0 left-0 flex items-center pl-3 transition-transform duration-300 group-hover:scale-110">
                                <i class="fas fa-paper-plane"></i>
                            </span>
                            <span class="ml-6">Invia Email</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </div>

    <div id="successToast" class="fixed bottom-5 right-5 transform translate-y-full opacity-0 transition-all duration-500">
        <div class="bg-gradient-to-r from-green-500 to-emerald-500 text-white px-6 py-4 rounded-lg shadow-lg flex items-center space-x-2">
            <i class="fas fa-check-circle text-xl"></i>
            <span>Email inviata con successo!</span>
        </div>
    </div>

    <div id="errorToast" class="fixed bottom-5 right-5 transform translate-y-full opacity-0 transition-all duration-500">
        <div class="bg-gradient-to-r from-red-500 to-pink-500 text-white px-6 py-4 rounded-lg shadow-lg flex items-center space-x-2">
            <i class="fas fa-exclamation-circle text-xl"></i>
            <span>Errore nell'invio dell'email. Riprova.</span>
        </div>
    </div>

    <script>
        const theme = document.documentElement.classList;
        const themeToggle = document.getElementById('themeToggle');
        
        if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            theme.add('dark');
        }

        themeToggle.addEventListener('click', () => {
            theme.toggle('dark');
            localStorage.theme = theme.contains('dark') ? 'dark' : 'light';
        });

        document.getElementById('emailForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const submitButton = e.target.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span class="ml-2">Invio in corso...</span>';
            
            try {
                const response = await fetch('/send_email', {
                    method: 'POST',
                    body: new FormData(e.target)
                });
                
                if (response.ok) {
                    showToast('successToast');
                    e.target.reset();
                } else {
                    showToast('errorToast');
                }
            } catch (error) {
                showToast('errorToast');
            } finally {
                submitButton.disabled = false;
                submitButton.innerHTML = '<i class="fas fa-paper-plane"></i><span class="ml-2">Invia Email</span>';
            }
        });

        function showToast(toastId) {
            const toast = document.getElementById(toastId);
            toast.style.transform = 'translateY(0)';
            toast.style.opacity = '1';
            
            setTimeout(() => {
                toast.style.transform = 'translateY(100%)';
                toast.style.opacity = '0';
            }, 3000);
        }

        const textarea = document.getElementById('message');
        textarea.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });
    </script>
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